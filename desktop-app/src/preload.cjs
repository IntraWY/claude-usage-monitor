const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("usage", {
  read: () => ipcRenderer.invoke("read"),
  refresh: () => ipcRenderer.invoke("refresh"),
  save: (s) => ipcRenderer.invoke("save", s),
  add: (p) => ipcRenderer.invoke("add", p),
  remove: (id) => ipcRenderer.invoke("remove", id),
  restore: (id) => ipcRenderer.invoke("restore", id),
  copyCLILogin: () => ipcRenderer.invoke("copy-cli-login"),
  reconnect: (id) => ipcRenderer.invoke("reconnect", id),
  close: () => ipcRenderer.send("close"),
  onUpdate: (cb) => {
    ipcRenderer.on("updated", (_, s) => cb(s));
  },
});
