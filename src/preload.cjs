const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("monitor", {
  call: (action, data) => ipcRenderer.invoke("monitor", action, data),
});
