import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "sales-report-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "newhome_sales_report" && m.title === "新房销售报告已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const project = app.call(
  "newhome.projects.save",
  {
    name: "销售报告更新通知盘",
    address: "更新大道 9 号",
    property_type: "residential",
    protection_days: 15,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

const customer = app.call(
  "customer.create",
  { name: "销售更新客", phone: "13892001111", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const registration = app.call(
  "newhome.registrations.create",
  { project_id: projectId, customer_id: data<any>(customer).id, source: "自拓" },
  agent
);
assert(registration.ok, "register customer");
const registrationId = data<any>(registration).id;
assert(
  app.call(
    "newhome.registrations.arrival",
    { id: registrationId, arrival_note: "到场认购" },
    agent
  ).ok,
  "confirm arrival"
);

const sale = app.call(
  "newhome.sales.create",
  {
    registration_id: registrationId,
    building: "B栋",
    unit_no: "1801",
    area_size: 89,
    contract_price: 1650000,
    signed_at: "2026-08-15",
  },
  agent
);
assert(sale.ok, "agent creates sales report");
const saleId = data<any>(sale).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "newhome.sales.update",
  {
    id: saleId,
    building: "B栋",
    unit_no: "1808",
    area_size: 92,
    contract_price: 1688000,
    signed_at: "2026-08-16",
  },
  agent
);
assert(updated.ok, "agent updates sales report");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "updater does not self-notify");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === saleId &&
      m.ref_type === "newhome_sales_report" &&
      String(m.body).includes("销售报告更新通知盘") &&
      String(m.body).includes("1808") &&
      String(m.body).includes("1688000")
  ),
  "update message body"
);

const beforeSelfMgr = updateMsgs(manager).length;
const beforeSelfAdmin = updateMsgs(admin).length;
assert(
  app.call(
    "newhome.sales.update",
    {
      id: saleId,
      unit_no: "1809",
      contract_price: 1690000,
      signed_at: "2026-08-17",
    },
    manager
  ).ok,
  "manager updates sales report"
);
assert(updateMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(updateMsgs(admin).length === beforeSelfAdmin + 1, "admin notified for manager update");

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, manager).ok,
  "mute newhome"
);
const beforeMute = updateMsgs(manager).length;
const beforeMuteAdmin = updateMsgs(admin).length;
assert(
  app.call(
    "newhome.sales.update",
    {
      id: saleId,
      unit_no: "1810",
      contract_price: 1700000,
      signed_at: "2026-08-18",
    },
    agent
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted newhome suppresses message");
assert(updateMsgs(admin).length === beforeMuteAdmin + 1, "admin still receives when manager muted");

console.log(`Sales report update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
