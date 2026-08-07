const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const renderer =
  process.env.WEILAIJIA_RENDERER || "http://127.0.0.1:5173";
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
  win.loadURL(renderer);
}

app.whenReady().then(() => {
  ipcMain.handle("api:meta", () => ({ api }));
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
