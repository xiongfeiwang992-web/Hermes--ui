import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import https from "node:https";

// Shared CJS store (also used by main.dev.cjs / smoke)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createShellStore, evaluateUpdateFeed, ensureDir } = require("./shell-state.cjs");

const renderer =
  process.env.WEILAIJIA_RENDERER ||
  path.join(__dirname, "..", "dist-renderer", "index.html");
const api = process.env.WEILAIJIA_API || "http://127.0.0.1:8787";

const store = createShellStore({
  rootDir: path.join(app.getPath("userData"), "shell"),
  defaultDownloadDir: path.join(app.getPath("downloads"), "未来家下载"),
  updateFeedUrl: process.env.WEILAIJIA_UPDATE_URL || "",
});

const tabWindows = new Map<string, BrowserWindow>();

function loadRenderer(win: BrowserWindow) {
  if (renderer.startsWith("http")) win.loadURL(renderer);
  else win.loadFile(renderer);
}

function createWindow(title = "未来家本地", opts: { asInitial?: boolean } = {}) {
  const tab = opts.asInitial ? store.resetTabs(title) : store.openTab(title);
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  tabWindows.set(tab.id, win);
  win.on("closed", () => {
    tabWindows.delete(tab.id);
    try {
      const { tabs } = store.listTabs();
      if (tabs.some((item: any) => item.id === tab.id) && tabs.length > 1) {
        store.closeTab(tab.id);
      }
    } catch {
      /* keep last tab record */
    }
  });
  loadRenderer(win);
  return { win, tab };
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`更新源 HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("api:meta", () => ({ api }));
  ipcMain.handle("shell:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    downloadDir: store.getDownloadDir(),
    updateFeedConfigured: Boolean(store.getUpdateFeedUrl()),
  }));
  ipcMain.handle("shell:zoom", (_event, value: number) => {
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
    const directory = path.join(store.getDownloadDir(), "screenshots");
    ensureDir(directory);
    const filename = `截图-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const target = path.join(directory, filename);
    fs.writeFileSync(target, image.toPNG());
    const recorded = store.recordDownload({
      filename,
      path: target,
      source: "screenshot",
    });
    return { path: target, filename, download: recorded };
  });
  ipcMain.handle("shell:chooseFiles", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择业务附件",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("shell:openPath", async (_event, target: string) => {
    if (!path.isAbsolute(target)) throw new Error("附件路径无效");
    return shell.openPath(target);
  });
  ipcMain.handle("shell:downloads.get", () => ({
    directory: store.getDownloadDir(),
    items: store.listDownloads(),
  }));
  ipcMain.handle("shell:downloads.chooseDir", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择下载目录",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: store.getDownloadDir(),
    });
    if (result.canceled || !result.filePaths[0]) {
      return { directory: store.getDownloadDir(), canceled: true };
    }
    store.setDownloadDir(result.filePaths[0]);
    return { directory: store.getDownloadDir(), canceled: false };
  });
  ipcMain.handle("shell:downloads.clear", () => {
    store.clearDownloads();
    return { ok: true, items: [] };
  });
  ipcMain.handle("shell:downloads.openDir", async () => {
    const directory = store.getDownloadDir();
    return shell.openPath(directory);
  });
  ipcMain.handle("shell:tabs.list", () => store.listTabs());
  ipcMain.handle("shell:tabs.open", (_event, title?: string) => {
    const { tab } = createWindow(title || `标签 ${store.listTabs().tabs.length + 1}`);
    return store.listTabs();
  });
  ipcMain.handle("shell:tabs.focus", (_event, tabId: string) => {
    store.focusTab(tabId);
    const win = tabWindows.get(tabId);
    win?.show();
    win?.focus();
    return store.listTabs();
  });
  ipcMain.handle("shell:tabs.close", (_event, tabId: string) => {
    const win = tabWindows.get(tabId);
    store.closeTab(tabId);
    if (win && !win.isDestroyed()) win.close();
    return store.listTabs();
  });
  ipcMain.handle("shell:update.check", async () => {
    const feedUrl = store.getUpdateFeedUrl();
    const base = evaluateUpdateFeed({
      currentVersion: app.getVersion(),
      feedUrl,
    });
    if (base.reason !== "pending_fetch" || !feedUrl) return base;
    try {
      const remote = await fetchJson(feedUrl);
      return evaluateUpdateFeed({
        currentVersion: app.getVersion(),
        feedUrl,
        remote,
      });
    } catch (err: any) {
      return {
        available: false,
        checked: true,
        reason: "fetch_failed",
        message: err?.message || "更新源不可用",
        currentVersion: app.getVersion(),
        feedUrl,
      };
    }
  });

  createWindow("主页面", { asInitial: true });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
