import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createShellStore,
  evaluateUpdateFeed,
  compareSemver,
} = require("../electron/shell-state.cjs") as {
  createShellStore: (options?: any) => any;
  evaluateUpdateFeed: (params?: any) => any;
  compareSemver: (a: string, b: string) => number;
};

let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "weilaijia-shell-"));
const downloadDir = path.join(root, "downloads-default");
const store = createShellStore({
  rootDir: path.join(root, "state"),
  defaultDownloadDir: downloadDir,
  updateFeedUrl: "",
});

check(store.getDownloadDir() === downloadDir, "default download directory");
check(fs.existsSync(downloadDir), "default download directory created");

const customDir = path.join(root, "custom-downloads");
store.setDownloadDir(customDir);
check(store.getDownloadDir() === customDir, "set custom download directory");

const recorded = store.recordDownload({
  filename: "导出.csv",
  path: path.join(customDir, "导出.csv"),
  source: "export",
});
check(recorded.id && recorded.filename === "导出.csv", "record download history item");
check(store.listDownloads().length === 1, "list download history");
store.clearDownloads();
check(store.listDownloads().length === 0, "clear download history");

const initial = store.resetTabs("主页面");
check(initial.title === "主页面", "reset session with initial tab");
const second = store.openTab("成交工作台");
check(store.listTabs().tabs.length === 2, "open second tab");
check(store.listTabs().activeTabId === second.id, "new tab becomes active");
store.focusTab(initial.id);
check(store.listTabs().activeTabId === initial.id, "focus switches active tab");

let closedLast = false;
try {
  store.closeTab(initial.id);
  store.closeTab(second.id);
} catch {
  closedLast = true;
}
check(store.listTabs().tabs.length === 1, "keep at least one tab after close");
check(closedLast, "reject closing the last tab");

check(compareSemver("1.2.0", "1.1.9") > 0, "semver compare newer");
check(compareSemver("1.2.0", "1.2.0") === 0, "semver compare equal");

const noFeed = evaluateUpdateFeed({ currentVersion: "0.1.0", feedUrl: "" });
check(noFeed.reason === "no_feed" && noFeed.available === false, "update check without feed");

const insecure = evaluateUpdateFeed({
  currentVersion: "0.1.0",
  feedUrl: "http://example.com/feed.json",
});
check(insecure.reason === "insecure_feed", "reject non-https update feed");

const pending = evaluateUpdateFeed({
  currentVersion: "0.1.0",
  feedUrl: "https://example.com/feed.json",
});
check(pending.reason === "pending_fetch", "https feed waits for remote payload");

const available = evaluateUpdateFeed({
  currentVersion: "0.1.0",
  feedUrl: "https://example.com/feed.json",
  remote: { version: "0.2.0", notes: "bugfix" },
});
check(available.available === true && available.remoteVersion === "0.2.0", "detect available update");

const current = evaluateUpdateFeed({
  currentVersion: "0.2.0",
  feedUrl: "https://example.com/feed.json",
  remote: { version: "0.2.0" },
});
check(current.available === false && current.reason === "up_to_date", "up to date when versions match");

store.setUpdateFeedUrl("https://updates.example.com/latest.json");
check(store.getUpdateFeedUrl().startsWith("https://"), "persist update feed url");

console.log(`Desktop shell smoke result: passed=${passed} failed=${failed}`);
fs.rmSync(root, { recursive: true, force: true });
if (failed) process.exit(1);
