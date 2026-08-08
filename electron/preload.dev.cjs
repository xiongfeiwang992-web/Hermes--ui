const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("weilaijia", {
  getMeta: () => ipcRenderer.invoke("api:meta"),
  shell: {
    info: () => ipcRenderer.invoke("shell:info"),
    zoom: (factor) => ipcRenderer.invoke("shell:zoom", factor),
    toggleFullscreen: () => ipcRenderer.invoke("shell:fullscreen"),
    clearCache: () => ipcRenderer.invoke("shell:clearCache"),
    screenshot: () => ipcRenderer.invoke("shell:screenshot"),
    chooseFiles: () => ipcRenderer.invoke("shell:chooseFiles"),
    openPath: (path) => ipcRenderer.invoke("shell:openPath", path),
    getDownloads: () => ipcRenderer.invoke("shell:downloads.get"),
    chooseDownloadDir: () => ipcRenderer.invoke("shell:downloads.chooseDir"),
    clearDownloads: () => ipcRenderer.invoke("shell:downloads.clear"),
    openDownloadDir: () => ipcRenderer.invoke("shell:downloads.openDir"),
    listTabs: () => ipcRenderer.invoke("shell:tabs.list"),
    openTab: (title) => ipcRenderer.invoke("shell:tabs.open", title),
    focusTab: (tabId) => ipcRenderer.invoke("shell:tabs.focus", tabId),
    closeTab: (tabId) => ipcRenderer.invoke("shell:tabs.close", tabId),
    checkUpdate: () => ipcRenderer.invoke("shell:update.check"),
  },
});
