const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopHost", {
  isAvailable: () => ipcRenderer.invoke("desktop-host:available"),
  getSystemInfo: () => ipcRenderer.invoke("desktop-host:get-system-info"),
  getSafeActions: () => ipcRenderer.invoke("desktop-host:get-safe-actions"),
  runAction: (actionId, context) => ipcRenderer.invoke("desktop-host:run-action", actionId, context),
});
