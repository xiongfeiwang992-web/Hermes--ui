import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "campaign-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "marketing" && m.title === "营销活动已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const options = app.call("marketing.options", {}, manager);
assert(options.ok, "manager marketing options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

assert(
  !app.call(
    "marketing.campaigns.create",
    {
      name: "",
      channel: "website",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      budget: 100,
      store_id: storeA,
    },
    manager
  ).ok,
  "name required"
);

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agentA).length;
const created = app.call(
  "marketing.campaigns.create",
  {
    name: "创建通知活动",
    channel: "website",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    budget: 1200,
    store_id: storeA,
  },
  manager
);
assert(created.ok, "manager creates campaign");
const campaignId = data<any>(created).id;
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(createMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(createMsgs(agentA).length === beforeAgent, "agent not notified on create");
assert(
  createMsgs(admin).some(
    (m) =>
      m.ref_id === campaignId &&
      String(m.body).includes("创建通知活动") &&
      String(m.body).includes("website")
  ),
  "create message body"
);

const beforeManager2 = createMsgs(manager).length;
const beforeAdmin2 = createMsgs(admin).length;
assert(
  app.call(
    "marketing.campaigns.create",
    {
      name: "管理员创建活动",
      channel: "wechat",
      start_date: "2026-02-01",
      end_date: "2026-08-01",
      budget: 800,
      store_id: storeA,
    },
    admin
  ).ok,
  "admin creates campaign"
);
assert(createMsgs(manager).length === beforeManager2 + 1, "store manager receives when admin creates");
assert(createMsgs(admin).length === beforeAdmin2, "admin actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { marketing: false } }, admin).ok,
  "mute marketing"
);
const beforeMute = createMsgs(admin).length;
assert(
  app.call(
    "marketing.campaigns.create",
    {
      name: "静音创建活动",
      channel: "phone",
      start_date: "2026-03-01",
      end_date: "2026-09-01",
      budget: 300,
      store_id: storeA,
    },
    manager
  ).ok,
  "create while muted"
);
assert(createMsgs(admin).length === beforeMute, "muted marketing suppresses create");

console.log(`Campaign create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
