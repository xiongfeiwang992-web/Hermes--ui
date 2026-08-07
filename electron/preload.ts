import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("weilaijia", {
  getMeta: () => ipcRenderer.invoke("api:meta"),
});
