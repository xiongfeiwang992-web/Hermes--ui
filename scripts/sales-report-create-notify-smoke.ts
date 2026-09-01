import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "sales-report-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "newhome_sales_report" && m.title === "新房销售报告已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const project = app.call(
  "newhome.projects.save",
  {
    name: "销售报告通知盘",
    address: "通知大道 9 号",
    property_type: "residential",
    protection_days: 15,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

const customer = app.call(
  "customer.create",
  { name: "销售通知客", phone: "13891001111", intent: "buy" },
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

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agent).length;
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
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(createMsgs(manager).length === beforeManager + 1, "manager receives create message");
assert(createMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  createMsgs(manager).some(
    (m) =>
      m.ref_id === saleId &&
      String(m.body).includes("销售报告通知盘") &&
      String(m.body).includes("1801") &&
      String(m.body).includes("1650000")
  ),
  "create message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, manager).ok,
  "mute newhome"
);
const customer2 = app.call(
  "customer.create",
  { name: "静音销售客", phone: "13891002222", intent: "buy" },
  agent
);
const reg2 = app.call(
  "newhome.registrations.create",
  { project_id: projectId, customer_id: data<any>(customer2).id },
  agent
);
assert(reg2.ok, "second registration");
assert(
  app.call(
    "newhome.registrations.arrival",
    { id: data<any>(reg2).id, arrival_note: "到场" },
    agent
  ).ok,
  "second arrival"
);
const beforeMute = createMsgs(manager).length;
const beforeMuteAdmin = createMsgs(admin).length;
assert(
  app.call(
    "newhome.sales.create",
    {
      registration_id: data<any>(reg2).id,
      unit_no: "1802",
      contract_price: 1700000,
      signed_at: "2026-08-16",
    },
    agent
  ).ok,
  "create while muted"
);
assert(createMsgs(manager).length === beforeMute, "muted newhome suppresses message");
assert(createMsgs(admin).length === beforeMuteAdmin + 1, "admin still receives when manager muted");

console.log(`Sales report create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
