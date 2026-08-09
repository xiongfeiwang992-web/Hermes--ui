import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-registration-expire-notify-smoke.db")).dbPath
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
const expireMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "newhome_registration" && m.title === "新房报备已过期"
  );
const pastProtectUntil = () => new Date(Date.now() - 86400000).toISOString();

const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");

const project = app.call(
  "newhome.projects.save",
  {
    name: "过期通知楼盘",
    address: "过期大道 9 号",
    property_type: "residential",
    protection_days: 12,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

function createRegistration(phone: string, name: string) {
  const customer = app.call(
    "customer.create",
    { name, phone, intent: "buy" },
    agent
  );
  assert(customer.ok, `create customer ${name}`);
  const registration = app.call(
    "newhome.registrations.create",
    {
      project_id: projectId,
      customer_id: data<any>(customer).id,
      source: "门店到访",
    },
    agent
  );
  assert(registration.ok, `register ${name}`);
  return data<any>(registration);
}

assert(
  !app.call("newhome.registrations.expire", {}, agent).ok,
  "agent cannot expire registrations"
);
assert(
  !app.call("newhome.registrations.expire", {}, finance).ok,
  "finance cannot expire registrations"
);

const silent = createRegistration("13832001001", "列表静默客");
app.db
  .prepare(`UPDATE newhome_registrations SET protect_until=? WHERE id=?`)
  .run(pastProtectUntil(), silent.id);
const beforeSilent = expireMsgs(agent).length;
const listed = app.call("newhome.registrations.list", { status: "expired" }, agent);
assert(
  listed.ok && data<any[]>(listed).some((item) => item.id === silent.id),
  "list lazily marks overdue registration expired"
);
assert(expireMsgs(agent).length === beforeSilent, "lazy list refresh does not notify");

const target = createRegistration("13832001002", "显式过期客");
const protectUntil = pastProtectUntil();
app.db
  .prepare(`UPDATE newhome_registrations SET protect_until=? WHERE id=?`)
  .run(protectUntil, target.id);
const beforeAgent = expireMsgs(agent).length;
const beforeManager = expireMsgs(manager).length;
const expired = app.call("newhome.registrations.expire", {}, manager);
assert(expired.ok, "manager expires overdue registrations");
assert(data<any>(expired).expired === 1, "exactly one registration expired");

const afterAgent = expireMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives expire message");
assert(
  afterAgent.some(
    (m) =>
      m.ref_id === target.id &&
      String(m.body).includes("过期通知楼盘") &&
      String(m.body).includes(protectUntil.slice(0, 10))
  ),
  "message refs registration with project and protect date"
);
assert(expireMsgs(manager).length === beforeManager, "manager does not self-notify");

const second = app.call("newhome.registrations.expire", {}, manager);
assert(second.ok && data<any>(second).expired === 0, "second expire is idempotent empty");
assert(
  expireMsgs(agent).length === afterAgent.length,
  "idempotent expire does not re-notify"
);

const muted = createRegistration("13832001003", "静音过期客");
app.db
  .prepare(`UPDATE newhome_registrations SET protect_until=? WHERE id=?`)
  .run(pastProtectUntil(), muted.id);
assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, agent).ok,
  "mute newhome channel"
);
const beforeMute = expireMsgs(agent).length;
const mutedExpire = app.call("newhome.registrations.expire", {}, manager);
assert(
  mutedExpire.ok && data<any>(mutedExpire).expired === 1,
  "manager expires muted agent registration"
);
assert(
  data<any[]>(app.call("newhome.registrations.list", { status: "expired" }, agent)).some(
    (item) => item.id === muted.id
  ),
  "muted registration reached expired status"
);
assert(expireMsgs(agent).length === beforeMute, "muted newhome suppresses expire message");

console.log(
  `Newhome registration expire notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
