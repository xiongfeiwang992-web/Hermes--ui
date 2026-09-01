import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-contact-create-notify-smoke.db")).dbPath
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
const contactMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_contact" && m.title === "客源联系人已登记"
  );

const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "customer.create",
  { name: "联系人通知客", phone: "13977001111", intent: "buy", need: "联系人通知" },
  agent
);
assert(created.ok, "agent creates customer");
const customerId = data<any>(created).id;

const beforeAgent = contactMsgs(agent).length;
const beforeManager = contactMsgs(manager).length;
const upsert = app.call(
  "customer.contacts.upsert",
  {
    customer_id: customerId,
    name: "紧急联系人",
    relation: "配偶",
    phone: "13977002222",
  },
  manager
);
assert(upsert.ok, "manager registers contact");
const contactId = data<any>(upsert).id;
assert(contactMsgs(agent).length === beforeAgent + 1, "agent receives contact message");
assert(contactMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  contactMsgs(agent).some(
    (m) =>
      m.ref_id === contactId &&
      String(m.body).includes("联系人通知客") &&
      String(m.body).includes("紧急联系人") &&
      String(m.body).includes("13977002222")
  ),
  "contact message body"
);

const beforeUpdate = contactMsgs(agent).length;
const updated = app.call(
  "customer.contacts.upsert",
  {
    id: contactId,
    customer_id: customerId,
    name: "紧急联系人改",
    relation: "配偶",
    phone: "13977002222",
  },
  manager
);
assert(updated.ok, "manager updates contact");
assert(contactMsgs(agent).length === beforeUpdate, "update does not re-notify");

const own = app.call(
  "customer.create",
  { name: "自登联系人客", phone: "13977003333", intent: "rent", need: "自登" },
  agent
);
assert(own.ok, "agent creates own customer");
const beforeSelf = contactMsgs(agent).length;
const selfUpsert = app.call(
  "customer.contacts.upsert",
  {
    customer_id: data<any>(own).id,
    name: "本人联系人",
    relation: "本人",
    phone: "13977004444",
  },
  agent
);
assert(selfUpsert.ok, "agent registers own contact");
assert(contactMsgs(agent).length === beforeSelf, "agent skips self-notify on own customer");

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, agent).ok,
  "mute customer"
);
const beforeMute = contactMsgs(agent).length;
const muted = app.call(
  "customer.contacts.upsert",
  {
    customer_id: customerId,
    name: "静音联系人",
    relation: "朋友",
    phone: "13977005555",
  },
  manager
);
assert(muted.ok, "register while muted");
assert(contactMsgs(agent).length === beforeMute, "muted customer suppresses message");

console.log(`Customer contact create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
