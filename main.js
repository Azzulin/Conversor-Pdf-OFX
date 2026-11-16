// Processo principal do app desktop (Electron).
// Ao iniciar, procura uma versão nova por alguns segundos; se houver, baixa, instala e reinicia.
// Depois abre a interface (app/index.html), que grava os OFX na pasta escolhida.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs/promises");

const URL_RELEASES = "https://github.com/Azzulin/Conversor-Pdf-OFX/releases/latest";
const TEMPO_BUSCA_MS = 8000; // tempo máximo procurando atualização ao abrir
const PRELOAD = path.join(__dirname, "preload.js");

const pastasPermitidas = new Set();

/* ---------- janelas ---------- */

function criarJanela() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 500,
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
  return win;
}

function criarJanelaAtualizacao() {
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
  w.once("ready-to-show", () => w.show());
  return w;
}

function enviarStatus(w, dados) {
  if (w && !w.isDestroyed()) w.webContents.send("atualizacao-status", dados);
}

function fechar(w) {
  if (w && !w.isDestroyed()) w.destroy();
}

/* ---------- atualização automática ---------- */

function versaoMaior(a, b) {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
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
      new Promise(res => setTimeout(() => res(null), TEMPO_BUSCA_MS)),
    ]);
    const info = r && r.updateInfo;
    return info && versaoMaior(info.version, app.getVersion()) ? info : null;
  } catch {
    return null; // sem internet, GitHub fora do ar etc.: segue sem atualizar
  }
}

async function iniciar() {
  if (!app.isPackaged) { criarJanela(); return; } // em desenvolvimento não atualiza

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const tela = criarJanelaAtualizacao();
  enviarStatus(tela, { fase: "procurando" });
  const info = await procurarVersaoNova();

  if (!info) { fechar(tela); criarJanela(); return; }

  if (!instalaSozinho()) {
    fechar(tela);
    const win = criarJanela();
    win.webContents.once("did-finish-load", () => avisarVersaoNova(win, info.version));
    return;
  }

  let win = null;
  ipcMain.once("atualizacao-continuar", () => {
    if (win) return;
    fechar(tela);
    win = criarJanela();
  });

  autoUpdater.on("download-progress", p => {
    enviarStatus(tela, { fase: "baixando", versao: info.version, pct: Math.round(p.percent || 0) });
  });
  enviarStatus(tela, { fase: "baixando", versao: info.version, pct: 0 });

  try {
    await autoUpdater.downloadUpdate();
  } catch {
    if (!win) { fechar(tela); win = criarJanela(); }
    return;
  }

  if (!win) {
    enviarStatus(tela, { fase: "instalando", versao: info.version });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 900);
    return;
  }

  // Quem escolheu continuar sem esperar decide quando reiniciar.
  const r = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Reiniciar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
    title: "Atualização pronta",
    message: `A versão ${info.version} foi baixada.`,
    detail: "Se escolher Depois, ela será instalada quando você fechar o programa.",
  });
  if (r.response === 0) autoUpdater.quitAndInstall(true, true);
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
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    iniciar();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
