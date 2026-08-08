import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("weilaijia", {
  getMeta: () => ipcRenderer.invoke("api:meta"),
  shell: {
    info: () => ipcRenderer.invoke("shell:info"),
    zoom: (factor: number) => ipcRenderer.invoke("shell:zoom", factor),
    toggleFullscreen: () => ipcRenderer.invoke("shell:fullscreen"),
    clearCache: () => ipcRenderer.invoke("shell:clearCache"),
    screenshot: () => ipcRenderer.invoke("shell:screenshot"),
  },
});
