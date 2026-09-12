import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "distribution-company-create-notify-smoke.db")).dbPath
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
const companyMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "分销公司已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const cross = login("agent_c");

assert(
  !app.call(
    "newhome.distribution.save",
    { name: "经纪人不可建分销", contact_phone: "13900001111" },
    agent
  ).ok,
  "agent cannot create distribution company"
);

const beforeAdmin = companyMsgs(admin).length;
const beforeManager = companyMsgs(manager).length;
const beforeAgent = companyMsgs(agent).length;
const beforeCross = companyMsgs(cross).length;
const created = app.call(
  "newhome.distribution.save",
  {
    name: "分销登记通知公司",
    contact_name: "渠道甲",
    contact_phone: "13900002222",
    address: "城南大道 8 号",
  },
  manager
);
assert(created.ok, "manager creates distribution company");
const companyId = data<any>(created).id;
assert(companyMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(companyMsgs(manager).length === beforeManager, "manager actor skips self");
assert(companyMsgs(agent).length === beforeAgent, "agent not notified");
assert(companyMsgs(cross).length === beforeCross, "cross-store agent not notified");
assert(
  companyMsgs(admin).some(
    (m) =>
      m.ref_id === companyId &&
      m.ref_type === "newhome_distribution_company" &&
      String(m.body).includes("分销登记通知公司")
  ),
  "create message body"
);

const beforeUpdate = companyMsgs(admin).length;
assert(
  app.call(
    "newhome.distribution.save",
    {
      id: companyId,
      name: "分销登记通知公司改",
      contact_phone: "13900002222",
    },
    manager
  ).ok,
  "manager updates distribution company"
);
assert(companyMsgs(admin).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMute = companyMsgs(admin).length;
assert(
  app.call(
    "newhome.distribution.save",
    { name: "静音分销公司", contact_phone: "13900003333" },
    manager
  ).ok,
  "create while muted"
);
assert(companyMsgs(admin).length === beforeMute, "muted other suppresses message");

console.log(
  `Distribution company create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
