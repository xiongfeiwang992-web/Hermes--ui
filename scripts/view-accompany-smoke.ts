import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "view-accompany-smoke.db")).dbPath);
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

const agentA = login("agent_a");
const agentB = login("agent_b");
const agentC = login("agent_c");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const agentCId = data<any>(app.call("auth.me", {}, agentC)).id;

const house = app.call(
  "house.create",
  {
    title: "陪看盘",
    deal_type: "sale",
    community: "陪看苑",
    price: 240,
    owner_name: "业主",
    owner_phone: "13680012001",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "陪看客", phone: "13680012002", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");

assert(
  !app.call(
    "view.create",
    {
      customer_id: data<any>(customer).id,
      house_id: data<any>(house).id,
      view_at: new Date().toISOString(),
      accompany_ids: [agentAId],
    },
    agentA
  ).ok,
  "reject accompany self"
);

assert(
  !app.call(
    "view.create",
    {
      customer_id: data<any>(customer).id,
      house_id: data<any>(house).id,
      view_at: new Date().toISOString(),
      accompany_ids: [agentCId],
    },
    agentA
  ).ok,
  "reject other store accompany"
);

assert(
  !app.call(
    "view.create",
    {
      customer_id: data<any>(customer).id,
      house_id: data<any>(house).id,
      view_at: new Date().toISOString(),
      accompany_ids: ["U_missing"],
    },
    agentA
  ).ok,
  "reject missing accompany"
);

const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const createdOk = app.call(
  "view.create",
  {
    customer_id: data<any>(customer).id,
    house_id: data<any>(house).id,
    view_at: new Date().toISOString(),
    accompany_ids: [agentBId, managerId],
  },
  agentA
);
assert(createdOk.ok, "create with accompany");
const viewId = data<any>(createdOk).id;
assert(
  data<any>(createdOk).accompany_ids.includes(agentBId) &&
    data<any>(createdOk).accompany_ids.includes(managerId),
  "accompany ids persisted"
);
assert(
  Array.isArray(data<any>(createdOk).accompany_names) &&
    data<any>(createdOk).accompany_names.length === 2,
  "accompany names presented"
);
assert(Boolean(data<any>(createdOk).accompany_summary), "accompany summary");
assert(Boolean(data<any>(createdOk).agent_name), "agent name presented");

const listed = data<any[]>(app.call("view.list", {}, manager)).find((row) => row.id === viewId);
assert(listed?.accompany_summary && listed.agent_name, "list shows accompany/agent names");

assert(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (msg) => msg.kind === "view_accompany" && msg.ref_id === viewId
  ),
  "accompany notified"
);
assert(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (msg) => msg.kind === "view_accompany" && msg.ref_id === viewId
  ),
  "manager accompany notified"
);
assert(
  !data<any[]>(app.call("message.list", {}, agentA)).some(
    (msg) => msg.kind === "view_accompany" && msg.ref_id === viewId
  ),
  "main agent not self-notified as accompany"
);

const plain = app.call(
  "view.create",
  {
    customer_id: data<any>(customer).id,
    house_id: data<any>(house).id,
    view_at: new Date().toISOString(),
  },
  agentA
);
assert(plain.ok, "create without accompany");
assert(
  Array.isArray(data<any>(plain).accompany_ids) && data<any>(plain).accompany_ids.length === 0,
  "empty accompany ok"
);

console.log(`View accompany smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
