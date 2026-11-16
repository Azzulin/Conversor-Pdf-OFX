// Ponte segura entre a interface e o app desktop.
// Expõe só: salvar OFX, abrir a pasta salva, versão do app e o andamento da atualização.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  salvarOfx: (arquivos) => ipcRenderer.invoke("salvar-ofx", arquivos),
  abrirPasta: (pasta) => ipcRenderer.invoke("abrir-pasta", pasta),
  versao: () => ipcRenderer.invoke("versao"),
  atualizacao: {
    aoMudar: (cb) => ipcRenderer.on("atualizacao-status", (_evt, dados) => cb(dados)),
    continuarSemEsperar: () => ipcRenderer.send("atualizacao-continuar"),
  },
});
