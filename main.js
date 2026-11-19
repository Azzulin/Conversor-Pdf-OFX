// Processo principal do app desktop (Electron).
// Ao iniciar, procura uma versão nova por alguns segundos; se houver, baixa, instala e reinicia.
// Depois abre a interface (app/index.html), que grava os OFX na pasta escolhida.
//
// Regra importante: sempre abrir a janela principal ANTES de fechar a janela de atualização.
// Se as duas ficarem fechadas ao mesmo tempo, o Windows encerra o programa.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");

const URL_RELEASES = "https://github.com/Azzulin/Conversor-Pdf-OFX/releases/latest";
const URL_SITE = "https://azzulin.github.io/Conversor-Pdf-OFX/";
const TEMPO_BUSCA_MS = 8000; // tempo máximo procurando atualização ao abrir
const PRELOAD = path.join(__dirname, "preload.js");
// Teste automático do GitHub Actions: caminho do arquivo onde gravar o resultado.
const SMOKE = process.env.CONVERSOR_SMOKE || "";

const pastasPermitidas = new Set();
let janelaPrincipal = null;
let telaAtualizacao = null;
let instalando = false;
let saindo = false;
let pendente = null; // atualização baixada para instalar ao fechar ({ versao, instalador })

/* ---------- registro de diagnóstico ---------- */
// Grava em <dados do app>/registro.log (no Windows: %APPDATA%\Conversor de Extratos OFX\registro.log).

const memoria = [];
let arquivoRegistro = null;

function texto(p) {
  if (p instanceof Error) return p.stack || p.message;
  if (typeof p === "string") return p;
  try { return JSON.stringify(p); } catch { return String(p); }
}

function registrar(nivel, ...partes) {
  const linha = `${new Date().toISOString()} [${nivel}] ${partes.map(texto).join(" ")}`;
  memoria.push(linha);
  if (memoria.length > 300) memoria.shift();
  try {
    if (!arquivoRegistro) arquivoRegistro = path.join(app.getPath("userData"), "registro.log");
    try {
      if (fsSync.statSync(arquivoRegistro).size > 1000000) fsSync.renameSync(arquivoRegistro, arquivoRegistro + ".1");
    } catch { /* arquivo ainda não existe */ }
    fsSync.appendFileSync(arquivoRegistro, linha + "\n");
  } catch { /* sem permissão de escrita: segue sem registro em disco */ }
}

autoUpdater.logger = {
  info: (m) => registrar("info", "atualizador:", m),
  warn: (m) => registrar("aviso", "atualizador:", m),
  error: (m) => registrar("erro", "atualizador:", m),
  debug: () => {},
};
autoUpdater.on("error", (e) => registrar("erro", "atualizador:", e));

process.on("uncaughtException", (e) => { registrar("erro", "exceção:", e); garantirJanela(); });
process.on("unhandledRejection", (e) => registrar("erro", "promessa rejeitada:", e));

/* ---------- janelas ---------- */

function fechar(w) {
  if (w && !w.isDestroyed()) w.destroy(); // destroy não dispara o evento "close"
}

function criarJanela() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    show: false,
    title: "Conversor de Extratos OFX",
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.loadFile(path.join(__dirname, "app", "index.html"));

  // Links externos abrem no navegador; a janela do app nunca sai da interface.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on("render-process-gone", (_e, d) => registrar("erro", "interface encerrada:", d));
  return win;
}

// Abre (ou traz para frente) a janela principal e só então fecha a janela de atualização.
function abrirPrincipal() {
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
    janelaPrincipal.show();
    fechar(telaAtualizacao);
    return janelaPrincipal;
  }
  const win = criarJanela();
  janelaPrincipal = win;
  win.on("closed", () => { if (janelaPrincipal === win) janelaPrincipal = null; });

  let mostrada = false;
  const mostrar = () => {
    if (mostrada || win.isDestroyed()) return;
    mostrada = true;
    win.show();
    fechar(telaAtualizacao);
    registrar("info", "janela principal aberta");
    if (SMOKE) verificarSmoke(win);
  };
  win.once("ready-to-show", mostrar);
  setTimeout(mostrar, 6000); // garantia caso o evento não chegue
  return win;
}

function garantirJanela() {
  if (instalando || !app.isReady()) return;
  if (!janelaPrincipal || janelaPrincipal.isDestroyed()) abrirPrincipal();
}

function criarJanelaAtualizacao(aoFecharPeloUsuario) {
  const w = new BrowserWindow({
    width: 440,
    height: 230,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    show: false,
    center: true,
    title: "Conversor de Extratos OFX",
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.loadFile(path.join(__dirname, "app", "atualizacao.html"));
  w.once("ready-to-show", () => { if (!w.isDestroyed()) w.show(); });
  // Alt+F4 na janela de atualização = continuar sem esperar.
  // Ao instalar uma versão nova ou ao sair (ex.: Windows desligando), o fechamento é liberado.
  w.on("close", (e) => {
    if (saindo || instalando) return;
    e.preventDefault();
    aoFecharPeloUsuario();
  });
  return w;
}

function enviarStatus(dados) {
  const w = telaAtualizacao;
  if (w && !w.isDestroyed()) w.webContents.send("atualizacao-status", dados);
}

/* ---------- atualização automática ---------- */

function versaoMaior(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Só o instalador do Windows e o AppImage do Linux conseguem se atualizar sozinhos.
// A versão portátil e o Mac (sem assinatura da Apple) apenas avisam e abrem a página de download.
function instalaSozinho() {
  if (process.platform === "win32") return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return false;
}

async function avisarVersaoNova(win, versao) {
  if (!win || win.isDestroyed()) return;
  const r = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Baixar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
    title: "Nova versão disponível",
    message: `A versão ${versao} do Conversor de Extratos OFX está disponível.`,
    detail: "Ela pode trazer bancos novos e correções. Baixe e instale para atualizar.",
  });
  if (r.response === 0) shell.openExternal(URL_RELEASES);
}

async function procurarVersaoNova() {
  try {
    const r = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((res) => setTimeout(() => res("tempo"), TEMPO_BUSCA_MS)),
    ]);
    if (r === "tempo") { registrar("aviso", "busca de atualização passou do tempo limite"); return null; }
    const info = r && r.updateInfo;
    if (!info) { registrar("info", "atualizador inativo nesta instalação"); return null; }
    const nova = versaoMaior(info.version, app.getVersion());
    registrar("info", `versão publicada: ${info.version}; instalada: ${app.getVersion()}; atualizar: ${nova}`);
    return nova ? info : null;
  } catch (e) {
    registrar("aviso", "não foi possível procurar atualização:", e); // sem internet, GitHub fora etc.
    return null;
  }
}

// Registro da última tentativa de instalar. Se o programa abrir de novo ainda na versão antiga,
// a instalação falhou (ex.: o Smart App Control bloqueou o instalador sem assinatura) e
// a mesma versão não é tentada outra vez. Isso evita o ciclo "baixa, tenta instalar, fecha".
function arquivoTentativa() { return path.join(app.getPath("userData"), "tentativa-atualizacao.json"); }
function lerTentativa() { try { return JSON.parse(fsSync.readFileSync(arquivoTentativa(), "utf8")); } catch { return null; } }
function gravarTentativa(dados) { try { fsSync.writeFileSync(arquivoTentativa(), JSON.stringify(dados)); } catch { /* sem disco */ } }
function limparTentativa() { try { fsSync.unlinkSync(arquivoTentativa()); } catch { /* não existe */ } }

function quandoCarregar(win, fn) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", fn); else fn();
}

async function avisarBloqueio(win, versao) {
  if (!win || win.isDestroyed()) return;
  const r = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Abrir versão web", "Baixar instalador", "Fechar aviso"],
    defaultId: 0,
    cancelId: 2,
    title: "Atualização bloqueada",
    message: `Não foi possível instalar a versão ${versao} automaticamente.`,
    detail: "O Windows impediu o instalador de rodar (geralmente o Smart App Control, que bloqueia programas sem assinatura digital). " +
      "Você pode continuar usando esta versão, usar a versão web (sempre atualizada) ou baixar e instalar a versão nova manualmente.",
  });
  if (r.response === 0) shell.openExternal(URL_SITE);
  if (r.response === 1) shell.openExternal(URL_RELEASES);
}

function falhaAoInstalar(versao, e) {
  instalando = false;
  registrar("erro", `o instalador da versão ${versao} não pôde ser iniciado:`, e);
  gravarTentativa({ versao, quando: new Date().toISOString(), avisado: true });
  const win = abrirPrincipal();
  quandoCarregar(win, () => avisarBloqueio(win, versao));
}

// Windows: o próprio programa abre o instalador para perceber se o Windows bloquear.
// Só fecha depois que o instalador realmente começou.
function abrirInstalador(instalador, args, aoIniciar, aoFalhar) {
  let filho;
  try {
    filho = spawn(instalador, args, { detached: true, stdio: "ignore", windowsHide: true });
  } catch (e) { aoFalhar(e); return; }
  filho.once("error", aoFalhar);
  filho.once("spawn", () => { filho.unref(); aoIniciar(); });
}

function instalar(versao, instalador) {
  instalando = true;
  pendente = null;
  enviarStatus({ fase: "instalando", versao });
  registrar("info", `instalando a versão ${versao} e reiniciando`);
  gravarTentativa({ versao, quando: new Date().toISOString(), avisado: false });
  setTimeout(() => {
    if (process.platform === "win32" && instalador) {
      abrirInstalador(instalador, ["--updated", "/S", "--force-run"], () => {
        registrar("info", "instalador iniciado; fechando para concluir a atualização");
        setTimeout(() => app.quit(), 300);
      }, (e) => falhaAoInstalar(versao, e));
      return;
    }
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      falhaAoInstalar(versao, e);
    }
  }, 900);
}

async function iniciar() {
  registrar("info", `iniciando versão ${app.getVersion()} (${process.platform}${process.env.PORTABLE_EXECUTABLE_DIR ? ", portátil" : ""})`);
  if (!app.isPackaged) { abrirPrincipal(); return; } // em desenvolvimento não atualiza

  // Tentativa anterior concluída (já estamos na versão nova ou acima): esquece o registro.
  const anterior = lerTentativa();
  if (anterior && !versaoMaior(anterior.versao, app.getVersion())) {
    registrar("info", `atualização para a versão ${anterior.versao} concluída`);
    limparTentativa();
  }

  autoUpdater.autoDownload = false;
  // No Windows a instalação ao fechar é feita pelo próprio programa (para detectar bloqueio).
  autoUpdater.autoInstallOnAppQuit = !SMOKE && process.platform !== "win32";

  let continuou = false;
  const continuar = () => {
    if (continuou) return;
    continuou = true;
    registrar("info", "usuário continuou sem esperar");
    abrirPrincipal();
  };
  ipcMain.removeAllListeners("atualizacao-continuar");
  ipcMain.on("atualizacao-continuar", continuar);

  telaAtualizacao = criarJanelaAtualizacao(continuar);
  enviarStatus({ fase: "procurando" });

  const info = await procurarVersaoNova();
  if (!info) { abrirPrincipal(); return; }

  if (SMOKE || !instalaSozinho()) {
    const win = abrirPrincipal();
    if (!SMOKE) quandoCarregar(win, () => avisarVersaoNova(win, info.version));
    return;
  }

  const tentativa = lerTentativa();
  if (tentativa && tentativa.versao === info.version) {
    // Já tentou instalar esta versão e não deu certo: não tenta de novo, abre normalmente.
    registrar("aviso", `a instalação da versão ${info.version} já falhou antes; não será tentada de novo automaticamente`);
    const win = abrirPrincipal();
    if (!tentativa.avisado) {
      gravarTentativa({ ...tentativa, avisado: true });
      quandoCarregar(win, () => avisarBloqueio(win, info.version));
    }
    return;
  }

  autoUpdater.on("download-progress", (p) => {
    enviarStatus({ fase: "baixando", versao: info.version, pct: Math.round(p.percent || 0) });
  });
  enviarStatus({ fase: "baixando", versao: info.version, pct: 0 });

  let instalador = null;
  try {
    const arquivos = await autoUpdater.downloadUpdate();
    instalador = (arquivos || []).find((f) => /\.exe$/i.test(f)) || null;
  } catch (e) {
    registrar("erro", "falha ao baixar a atualização:", e);
    abrirPrincipal();
    return;
  }
  registrar("info", `versão ${info.version} baixada${instalador ? ": " + instalador : ""}`);

  if (!continuou) { instalar(info.version, instalador); return; }

  // Quem escolheu continuar sem esperar decide quando reiniciar.
  pendente = { versao: info.version, instalador };
  const win = janelaPrincipal;
  if (!win || win.isDestroyed()) return; // será instalada ao fechar o programa
  const r = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Reiniciar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
    title: "Atualização pronta",
    message: `A versão ${info.version} foi baixada.`,
    detail: "Se escolher Depois, ela será instalada quando você fechar o programa.",
  });
  if (r.response === 0) instalar(info.version, instalador);
}

/* ---------- teste automático (GitHub Actions) ---------- */

function terminarSmoke(ok, detalhes) {
  registrar(ok ? "info" : "erro", "teste automático:", ok ? "OK" : "FALHOU", detalhes);
  try {
    fsSync.writeFileSync(SMOKE, JSON.stringify({ ok, versao: app.getVersion(), detalhes, registro: memoria }, null, 2));
  } catch { /* o teste falha por falta do arquivo */ }
  app.exit(ok ? 0 : 1);
}

async function verificarSmoke(win) {
  try {
    await new Promise((r) => setTimeout(r, 3000)); // o defeito antigo fechava o programa logo depois de abrir
    const visivel = !win.isDestroyed() && win.isVisible();
    const estado = win.isDestroyed() ? null : await win.webContents.executeJavaScript(
      "({ pdf: !!window.pdfjsLib, libsLocais: !!window.__libsLocais, conversor: !!window.__conversorOfx," +
      " desktop: !!(window.desktop && window.desktop.salvarOfx), titulo: document.title })"
    );
    const ok = !!(visivel && estado && estado.pdf && estado.libsLocais && estado.conversor && estado.desktop);
    terminarSmoke(ok, { visivel, estado });
  } catch (e) {
    terminarSmoke(false, { erro: texto(e) });
  }
}

/* ---------- gravação dos OFX ---------- */

async function nomeLivre(destino) {
  const { dir, name, ext } = path.parse(destino);
  let candidato = destino;
  for (let n = 2; ; n++) {
    try {
      await fs.access(candidato);
      candidato = path.join(dir, `${name} (${n})${ext}`);
    } catch {
      return candidato;
    }
  }
}

ipcMain.handle("salvar-ofx", async (evt, arquivos) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const r = await dialog.showOpenDialog(win, {
    title: "Escolha a pasta para salvar os arquivos OFX",
    defaultPath: app.getPath("downloads"),
    buttonLabel: "Salvar aqui",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };

  const pasta = r.filePaths[0];
  const salvos = [];
  for (const a of Array.isArray(arquivos) ? arquivos : []) {
    const nome = path.basename(String(a && a.nome)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    if (!/\.ofx$/i.test(nome) || !a.bytes) continue;
    const destino = await nomeLivre(path.join(pasta, nome));
    await fs.writeFile(destino, Buffer.from(a.bytes));
    salvos.push(destino);
  }
  pastasPermitidas.add(pasta);
  registrar("info", `${salvos.length} arquivo(s) OFX salvo(s)`);
  return { pasta, salvos };
});

ipcMain.handle("abrir-pasta", async (_evt, pasta) => {
  // Só abre pastas onde o próprio app acabou de salvar arquivos.
  if (pastasPermitidas.has(pasta)) await shell.openPath(pasta);
});

ipcMain.handle("versao", () => app.getVersion());

/* ---------- ciclo de vida ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = janelaPrincipal && !janelaPrincipal.isDestroyed() ? janelaPrincipal : BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    if (SMOKE) setTimeout(() => terminarSmoke(false, { erro: "tempo esgotado sem abrir a janela principal" }), 60000);
    iniciar().catch((e) => { registrar("erro", "falha ao iniciar:", e); garantirJanela(); });
    app.on("activate", () => garantirJanela());
  });
  app.on("before-quit", () => { saindo = true; });
  app.on("will-quit", () => {
    // Instalar ao fechar (Windows), quando a pessoa escolheu "Depois"
    if (!pendente || instalando || process.platform !== "win32" || !pendente.instalador) return;
    const { versao, instalador } = pendente;
    pendente = null;
    instalando = true;
    gravarTentativa({ versao, quando: new Date().toISOString(), avisado: false });
    registrar("info", `instalando a versão ${versao} ao fechar o programa`);
    abrirInstalador(instalador, ["--updated", "/S"], () => {}, (e) => registrar("erro", "instalador bloqueado ao fechar:", e));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !instalando) app.quit();
  });
}
