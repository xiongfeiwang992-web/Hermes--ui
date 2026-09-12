import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-contact-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "customer_contact" && m.title === "客源联系人已更新"
  );

const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "customer.create",
  {
    name: "联系人更新通知客",
    phone: "13978001111",
    intent: "buy",
    need: "联系人更新通知",
  },
  agent
);
assert(created.ok, "agent creates customer");
const customerId = data<any>(created).id;

const upsert = app.call(
  "customer.contacts.upsert",
  {
    customer_id: customerId,
    name: "紧急联系人",
    relation: "配偶",
    phone: "13978002222",
  },
  manager
);
assert(upsert.ok, "manager registers contact");
const contactId = data<any>(upsert).id;
assert(updateMsgs(agent).length === 0, "create does not send update title");
assert(updateMsgs(manager).length === 0, "manager has no update message after create");

const beforeAgent = updateMsgs(agent).length;
const beforeManager = updateMsgs(manager).length;
const updated = app.call(
  "customer.contacts.upsert",
  {
    id: contactId,
    customer_id: customerId,
    name: "紧急联系人改",
    relation: "配偶",
    phone: "13978003333",
  },
  manager
);
assert(updated.ok, "manager updates contact");
assert(
  updateMsgs(agent).length === beforeAgent + 1,
  "agent receives contact update message"
);
assert(updateMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  updateMsgs(agent).some(
    (m) =>
      m.ref_id === contactId &&
      m.ref_type === "customer_contact" &&
      String(m.body).includes("联系人更新通知客") &&
      String(m.body).includes("紧急联系人改") &&
      String(m.body).includes("13978003333")
  ),
  "contact update message body"
);

const own = app.call(
  "customer.create",
  { name: "自改联系人客", phone: "13978004444", intent: "rent", need: "自改" },
  agent
);
assert(own.ok, "agent creates own customer");
const ownContact = app.call(
  "customer.contacts.upsert",
  {
    customer_id: data<any>(own).id,
    name: "本人联系人",
    relation: "本人",
    phone: "13978005555",
  },
  agent
);
assert(ownContact.ok, "agent registers own contact");
const beforeSelf = updateMsgs(agent).length;
assert(
  app.call(
    "customer.contacts.upsert",
    {
      id: data<any>(ownContact).id,
      customer_id: data<any>(own).id,
      name: "本人联系人改",
      relation: "本人",
      phone: "13978006666",
    },
    agent
  ).ok,
  "agent updates own contact"
);
assert(updateMsgs(agent).length === beforeSelf, "agent skips self-notify on own customer");

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, agent).ok,
  "mute customer"
);
const beforeMute = updateMsgs(agent).length;
assert(
  app.call(
    "customer.contacts.upsert",
    {
      id: contactId,
      customer_id: customerId,
      name: "静音后更新",
      relation: "朋友",
      phone: "13978007777",
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(agent).length === beforeMute, "muted customer suppresses update message");

console.log(
  `Customer contact update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
