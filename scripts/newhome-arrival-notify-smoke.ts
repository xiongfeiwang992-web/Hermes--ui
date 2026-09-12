import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-arrival-notify-smoke.db")).dbPath
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
const arrivalMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "newhome_registration" && m.title === "新房报备已到场"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const project = app.call(
  "newhome.projects.save",
  {
    name: "到场通知楼盘",
    address: "到场大道 3 号",
    property_type: "residential",
    protection_days: 15,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

function register(phone: string, name: string) {
  const customer = app.call(
    "customer.create",
    { name, phone, intent: "buy" },
    agent
  );
  assert(customer.ok, `create ${name}`);
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
  return data<any>(registration).id;
}

assert(
  !app.call(
    "newhome.registrations.arrival",
    { id: "missing", arrival_note: "短" },
    manager
  ).ok,
  "arrival note min length"
);

const regId = register("13822001001", "到场通知客");
const beforeAgent = arrivalMsgs(agent).length;
const beforeManager = arrivalMsgs(manager).length;
const beforePeer = arrivalMsgs(peer).length;
const arrived = app.call(
  "newhome.registrations.arrival",
  { id: regId, arrival_note: "客户已到场认购" },
  manager
);
assert(arrived.ok, "manager confirms arrival");
assert(Boolean(data<any>(arrived).arrived_at), "returns arrived_at");
const afterAgent = arrivalMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives arrival message");
assert(afterAgent[0].ref_id === regId, "message refs registration");
assert(String(afterAgent[0].body).includes("到场通知楼盘"), "body has project");
assert(String(afterAgent[0].body).includes("客户已到场认购"), "body has note");
assert(arrivalMsgs(manager).length === beforeManager, "confirmer does not self-notify");
assert(arrivalMsgs(peer).length === beforePeer, "peer not notified");
assert(
  !app.call(
    "newhome.registrations.arrival",
    { id: regId, arrival_note: "再次到场" },
    manager
  ).ok,
  "cannot confirm twice"
);

const selfId = register("13822001002", "自到场客");
const beforeSelf = arrivalMsgs(agent).length;
assert(
  app.call(
    "newhome.registrations.arrival",
    { id: selfId, arrival_note: "经纪人自行确认到场" },
    agent
  ).ok,
  "agent confirms own arrival"
);
assert(arrivalMsgs(agent).length === beforeSelf, "self-confirm skips notify");

const mutedId = register("13822001003", "静音到场客");
assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, agent).ok,
  "mute newhome channel"
);
const beforeMute = arrivalMsgs(agent).length;
assert(
  app.call(
    "newhome.registrations.arrival",
    { id: mutedId, arrival_note: "静音场景到场" },
    manager
  ).ok,
  "confirm while muted"
);
assert(arrivalMsgs(agent).length === beforeMute, "muted newhome suppresses arrival message");

console.log(`Newhome arrival notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
