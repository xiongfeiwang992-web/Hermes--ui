import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "distribution-company-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "分销公司已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const cross = login("agent_c");

const created = app.call(
  "newhome.distribution.save",
  {
    name: "分销更新通知公司",
    contact_name: "渠道乙",
    contact_phone: "13900004444",
    address: "城北大道 3 号",
  },
  manager
);
assert(created.ok, "manager creates distribution company");
const companyId = data<any>(created).id;

assert(
  !app.call(
    "newhome.distribution.save",
    {
      id: companyId,
      name: "经纪人不可改分销",
      contact_phone: "13900004444",
    },
    agent
  ).ok,
  "agent cannot update distribution company"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const beforeCross = updateMsgs(cross).length;
const updated = app.call(
  "newhome.distribution.save",
  {
    id: companyId,
    name: "分销更新通知公司改",
    contact_name: "渠道乙改",
    contact_phone: "13900004444",
    address: "城北大道 5 号",
  },
  manager
);
assert(updated.ok, "manager updates distribution company");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager, "manager actor skips self");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(updateMsgs(cross).length === beforeCross, "cross-store agent not notified");
assert(
  updateMsgs(admin).some(
    (m) =>
      m.ref_id === companyId &&
      m.ref_type === "newhome_distribution_company" &&
      String(m.body).includes("分销更新通知公司改")
  ),
  "update message body"
);

const beforeSelfAdmin = updateMsgs(admin).length;
const beforeSelfMgr = updateMsgs(manager).length;
assert(
  app.call(
    "newhome.distribution.save",
    {
      id: companyId,
      name: "管理员改分销公司",
      contact_phone: "13900004444",
    },
    admin
  ).ok,
  "admin updates distribution company"
);
assert(updateMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeSelfMgr + 1, "manager receives admin update");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMute = updateMsgs(admin).length;
assert(
  app.call(
    "newhome.distribution.save",
    {
      id: companyId,
      name: "静音分销更新",
      contact_phone: "13900004444",
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted other suppresses message");

console.log(
  `Distribution company update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
