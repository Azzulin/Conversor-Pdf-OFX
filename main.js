// Processo principal do app desktop (Electron).
// Abre a interface (app/index.html) e grava os arquivos OFX na pasta que o usuário escolher.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const pastasPermitidas = new Set();

function criarJanela() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    title: "Conversor de Extratos OFX",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
}

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    criarJanela();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
