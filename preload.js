// Ponte segura entre a interface e o app desktop: só expõe salvar OFX e abrir a pasta salva.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  salvarOfx: (arquivos) => ipcRenderer.invoke("salvar-ofx", arquivos),
  abrirPasta: (pasta) => ipcRenderer.invoke("abrir-pasta", pasta),
});
