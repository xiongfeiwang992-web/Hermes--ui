import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-register-notify-smoke.db")).dbPath
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
const registerMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "newhome_registration" && m.title === "新房报备已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const project = app.call(
  "newhome.projects.save",
  {
    name: "报备通知楼盘",
    address: "报备大道 8 号",
    property_type: "residential",
    protection_days: 12,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

let phoneSeq = 1100;
function createCustomer(token: string, name: string) {
  phoneSeq += 1;
  const customer = app.call(
    "customer.create",
    {
      name,
      phone: `1311${String(phoneSeq).padStart(7, "0")}`,
      intent: "buy",
    },
    token
  );
  assert(customer.ok, `create ${name}`);
  return data<any>(customer).id;
}

const customerId = createCustomer(agent, "报备通知客");
const beforeAgent = registerMsgs(agent).length;
const beforeManager = registerMsgs(manager).length;
const registered = app.call(
  "newhome.registrations.create",
  {
    project_id: projectId,
    customer_id: customerId,
    agent_id: agentId,
    source: "门店到访",
  },
  manager
);
assert(registered.ok, "manager registers for agent");
const regId = data<any>(registered).id;
assert(registerMsgs(agent).length === beforeAgent + 1, "agent receives register message");
assert(registerMsgs(manager).length === beforeManager, "manager actor does not self-notify");
assert(
  registerMsgs(agent).some(
    (m) =>
      m.ref_id === regId &&
      String(m.body).includes("报备通知楼盘") &&
      String(m.body).includes("报备通知客") &&
      String(m.body).includes("保护至")
  ),
  "register message body"
);

const selfCustomer = createCustomer(agent, "自报备客");
const beforeSelf = registerMsgs(agent).length;
assert(
  app.call(
    "newhome.registrations.create",
    {
      project_id: projectId,
      customer_id: selfCustomer,
      source: "自报备",
    },
    agent
  ).ok,
  "agent self-registers"
);
assert(registerMsgs(agent).length === beforeSelf, "self register skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, agent).ok,
  "mute newhome"
);
const mutedCustomer = createCustomer(agent, "静音报备客");
const beforeMute = registerMsgs(agent).length;
assert(
  app.call(
    "newhome.registrations.create",
    {
      project_id: projectId,
      customer_id: mutedCustomer,
      agent_id: agentId,
      source: "静音",
    },
    manager
  ).ok,
  "register while muted"
);
assert(registerMsgs(agent).length === beforeMute, "muted newhome suppresses register message");

void peer;
console.log(`Newhome register notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
