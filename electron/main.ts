import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

const renderer =
  process.env.WEILAIJIA_RENDERER ||
  path.join(__dirname, "..", "dist-renderer", "index.html");
const api = process.env.WEILAIJIA_API || "http://127.0.0.1:8787";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (renderer.startsWith("http")) win.loadURL(renderer);
  else win.loadFile(renderer);
}

app.whenReady().then(() => {
  ipcMain.handle("api:meta", () => ({ api }));
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
