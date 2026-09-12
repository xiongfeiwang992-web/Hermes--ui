import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "campaign-status-notify-smoke.db")).dbPath
);

let passed = 0;
let failed = 0;
const assert = (value: unknown, name: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const msgs = (token: string, title: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "marketing" && m.title === title
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentC = login("agent_c");
const finance = login("finance");

const options = app.call("marketing.options", {}, manager);
assert(options.ok, "manager marketing options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

const campaign = app.call(
  "marketing.campaigns.create",
  {
    name: "启用通知活动",
    channel: "website",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    budget: 1000,
    store_id: storeA,
  },
  manager
);
assert(campaign.ok, "create campaign");
const campaignId = data<any>(campaign).id;

assert(
  !app.call("marketing.campaigns.status", { id: campaignId, status: "closed" }, agentA).ok,
  "agent cannot change status"
);

const beforeA = msgs(agentA, "营销活动已启用").length;
const beforeB = msgs(agentB, "营销活动已启用").length;
const beforeC = msgs(agentC, "营销活动已启用").length;
const beforeM = msgs(manager, "营销活动已启用").length;
const beforeF = msgs(finance, "营销活动已启用").length;
assert(
  app.call("marketing.campaigns.status", { id: campaignId, status: "active" }, manager).ok,
  "manager activates campaign"
);
assert(msgs(agentA, "营销活动已启用").length === beforeA + 1, "agent_a receives activate");
assert(msgs(agentB, "营销活动已启用").length === beforeB + 1, "agent_b receives activate");
assert(msgs(agentC, "营销活动已启用").length === beforeC, "other store agent skipped");
assert(msgs(manager, "营销活动已启用").length === beforeM, "actor does not self-notify activate");
assert(msgs(finance, "营销活动已启用").length === beforeF, "finance not notified");
assert(
  msgs(agentA, "营销活动已启用").some(
    (m) =>
      m.ref_id === campaignId &&
      String(m.body).includes("启用通知活动") &&
      String(m.body).includes("website")
  ),
  "activate message body"
);

const beforeCloseA = msgs(agentA, "营销活动已关闭").length;
const beforeCloseM = msgs(manager, "营销活动已关闭").length;
assert(
  app.call("marketing.campaigns.status", { id: campaignId, status: "closed" }, admin).ok,
  "admin closes campaign"
);
assert(msgs(agentA, "营销活动已关闭").length === beforeCloseA + 1, "agent receives close");
assert(msgs(manager, "营销活动已关闭").length === beforeCloseM + 1, "manager receives close");
assert(
  msgs(agentA, "营销活动已关闭").some((m) => m.ref_id === campaignId),
  "close message refs campaign"
);

assert(
  app.call("message.subscriptions.save", { channels: { marketing: false } }, agentB).ok,
  "mute marketing"
);
const muted = app.call(
  "marketing.campaigns.create",
  {
    name: "静音启用活动",
    channel: "wechat",
    start_date: "2026-02-01",
    end_date: "2026-06-30",
    budget: 500,
    store_id: storeA,
  },
  manager
);
assert(muted.ok, "create muted campaign");
const mutedId = data<any>(muted).id;
const beforeMute = msgs(agentB, "营销活动已启用").length;
assert(
  app.call("marketing.campaigns.status", { id: mutedId, status: "active" }, manager).ok,
  "activate while muted"
);
assert(msgs(agentB, "营销活动已启用").length === beforeMute, "muted marketing suppresses");

console.log(`Campaign status notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
