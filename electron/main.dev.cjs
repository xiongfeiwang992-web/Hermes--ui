const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const renderer =
  process.env.WEILAIJIA_RENDERER || "http://127.0.0.1:5173";
const api = process.env.WEILAIJIA_API || "http://127.0.0.1:8787";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, "preload.dev.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(renderer);
}

app.whenReady().then(() => {
  ipcMain.handle("api:meta", () => ({ api }));
  ipcMain.handle("shell:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  }));
  ipcMain.handle("shell:zoom", (_event, value) => {
    const window = BrowserWindow.getFocusedWindow();
    const factor = Math.min(1.5, Math.max(0.8, Number(value) || 1));
    window?.webContents.setZoomFactor(factor);
    return { factor };
  });
  ipcMain.handle("shell:fullscreen", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (!window) return { fullscreen: false };
    window.setFullScreen(!window.isFullScreen());
    return { fullscreen: window.isFullScreen() };
  });
  ipcMain.handle("shell:clearCache", async () => {
    const window = BrowserWindow.getFocusedWindow();
    await window?.webContents.session.clearCache();
    window?.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle("shell:screenshot", async () => {
    const window = BrowserWindow.getFocusedWindow();
    if (!window) throw new Error("没有活动窗口");
    const image = await window.webContents.capturePage();
    const directory = path.join(app.getPath("pictures"), "未来家截图");
    fs.mkdirSync(directory, { recursive: true });
    const filename = `截图-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const target = path.join(directory, filename);
    fs.writeFileSync(target, image.toPNG());
    return { path: target, filename };
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
