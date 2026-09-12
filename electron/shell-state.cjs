const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Pure-ish desktop shell store for downloads, tabs, and update feed.
 * Paths are injectable so smoke tests can run without Electron.
 */

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function createShellStore(options = {}) {
  const root = options.rootDir || path.join(process.cwd(), ".weilaijia-shell");
  const stateFile = path.join(root, "shell-state.json");
  const defaultDownloadDir =
    options.defaultDownloadDir || path.join(root, "downloads");

  function load() {
    const state = readJson(stateFile, null) || {
      downloadDir: defaultDownloadDir,
      downloads: [],
      tabs: [],
      activeTabId: null,
      updateFeedUrl: options.updateFeedUrl || process.env.WEILAIJIA_UPDATE_URL || "",
    };
    if (!state.downloadDir) state.downloadDir = defaultDownloadDir;
    if (!Array.isArray(state.downloads)) state.downloads = [];
    if (!Array.isArray(state.tabs)) state.tabs = [];
    return state;
  }

  function save(state) {
    writeJson(stateFile, state);
    return state;
  }

  return {
    root,
    stateFile,
    getState() {
      return load();
    },
    getDownloadDir() {
      const state = load();
      return ensureDir(state.downloadDir || defaultDownloadDir);
    },
    setDownloadDir(dir) {
      const absolute = path.resolve(String(dir || "").trim());
      if (!absolute || absolute === path.parse(absolute).root) {
        throw new Error("下载目录无效");
      }
      ensureDir(absolute);
      const state = load();
      state.downloadDir = absolute;
      return save(state);
    },
    listDownloads() {
      return load().downloads.slice(0, 100);
    },
    recordDownload(entry) {
      const state = load();
      const item = {
        id: nextId("DL"),
        filename: String(entry.filename || path.basename(entry.path || "file")),
        path: String(entry.path || ""),
        source: String(entry.source || "manual"),
        created_at: nowIso(),
      };
      state.downloads = [item, ...state.downloads].slice(0, 100);
      save(state);
      return item;
    },
    clearDownloads() {
      const state = load();
      state.downloads = [];
      return save(state);
    },
    listTabs() {
      const state = load();
      return {
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      };
    },
    openTab(title = "业务页") {
      const state = load();
      const tab = {
        id: nextId("TAB"),
        title: String(title || "业务页"),
        created_at: nowIso(),
      };
      state.tabs.push(tab);
      state.activeTabId = tab.id;
      save(state);
      return tab;
    },
    focusTab(tabId) {
      const state = load();
      if (!state.tabs.some((tab) => tab.id === tabId)) {
        throw new Error("标签不存在");
      }
      state.activeTabId = tabId;
      return save(state);
    },
    closeTab(tabId) {
      const state = load();
      if (state.tabs.length <= 1) {
        throw new Error("至少保留一个标签");
      }
      const next = state.tabs.filter((tab) => tab.id !== tabId);
      if (next.length === state.tabs.length) throw new Error("标签不存在");
      state.tabs = next;
      if (state.activeTabId === tabId) {
        state.activeTabId = next[next.length - 1].id;
      }
      return save(state);
    },
    ensureInitialTab(title = "主页面") {
      const state = load();
      if (state.tabs.length) return state.tabs[0];
      return this.openTab(title);
    },
    resetTabs(title = "主页面") {
      const state = load();
      state.tabs = [];
      state.activeTabId = null;
      save(state);
      return this.openTab(title);
    },
    getUpdateFeedUrl() {
      return String(load().updateFeedUrl || "").trim();
    },
    setUpdateFeedUrl(url) {
      const state = load();
      state.updateFeedUrl = String(url || "").trim();
      return save(state);
    },
  };
}

/**
 * Evaluate update feed without network when empty / invalid.
 * When feed JSON is provided (tests), compare versions.
 */
function evaluateUpdateFeed(params = {}) {
  const currentVersion = String(params.currentVersion || "0.0.0");
  const feedUrl = String(params.feedUrl || "").trim();
  if (!feedUrl) {
    return {
      available: false,
      checked: true,
      reason: "no_feed",
      message: "未配置更新源（WEILAIJIA_UPDATE_URL）",
      currentVersion,
    };
  }
  if (!/^https:\/\//i.test(feedUrl)) {
    return {
      available: false,
      checked: true,
      reason: "insecure_feed",
      message: "更新源须为 HTTPS",
      currentVersion,
    };
  }
  const remote = params.remote || null;
  if (!remote) {
    return {
      available: false,
      checked: true,
      reason: "pending_fetch",
      message: "待拉取更新源",
      currentVersion,
      feedUrl,
    };
  }
  const remoteVersion = String(remote.version || "").trim();
  if (!remoteVersion) {
    return {
      available: false,
      checked: true,
      reason: "invalid_feed",
      message: "更新源缺少 version",
      currentVersion,
      feedUrl,
    };
  }
  const available = compareSemver(remoteVersion, currentVersion) > 0;
  return {
    available,
    checked: true,
    reason: available ? "update_available" : "up_to_date",
    message: available ? `发现新版本 ${remoteVersion}` : "已是最新版本",
    currentVersion,
    remoteVersion,
    feedUrl,
    notes: remote.notes || "",
  };
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

module.exports = {
  createShellStore,
  evaluateUpdateFeed,
  compareSemver,
  ensureDir,
};
