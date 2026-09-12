import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-list-filters-smoke.db")).dbPath);
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
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const mk = (
  token: string,
  name: string,
  phone: string,
  level: string,
  intent = "buy"
) => {
  const result = app.call(
    "customer.create",
    { name, phone, intent, level, need: `${name}需求` },
    token
  );
  assert(result.ok, `create ${name}`);
  return data<any>(result);
};

const aPrivate = mk(agentA, "甲客A", "13680006001", "A");
const bPrivate = mk(agentA, "甲客B", "13680006002", "B");
const bOther = mk(agentB, "乙客B", "13680006003", "B");

assert(aPrivate.level === "A" && aPrivate.status === "new", "default status new");
assert(aPrivate.agent_id === agentAId, "maintainer is creator");

const byLevel = data<any[]>(app.call("customer.list", { level: "A" }, manager));
assert(
  byLevel.every((row) => row.level === "A") &&
    byLevel.some((row) => row.id === aPrivate.id) &&
    !byLevel.some((row) => row.id === bPrivate.id),
  "filter by level A"
);

const byLevelB = data<any[]>(app.call("customer.list", { level: "B" }, manager));
assert(
  byLevelB.every((row) => row.level === "B") &&
    byLevelB.some((row) => row.id === bPrivate.id) &&
    byLevelB.some((row) => row.id === bOther.id),
  "filter by level B"
);

const byAgent = data<any[]>(app.call("customer.list", { agent_id: agentBId }, manager));
assert(
  byAgent.every((row) => row.agent_id === agentBId) &&
    byAgent.some((row) => row.id === bOther.id) &&
    !byAgent.some((row) => row.id === aPrivate.id),
  "filter by agent"
);

const byStatusNew = data<any[]>(app.call("customer.list", { status: "new" }, manager));
assert(
  byStatusNew.every((row) => row.status === "new") &&
    byStatusNew.some((row) => row.id === aPrivate.id),
  "filter by status new"
);

assert(
  app.call(
    "follow.create",
    {
      target_type: "customer",
      target_id: aPrivate.id,
      content: "电话沟通意向明确",
      method: "phone",
    },
    agentA
  ).ok,
  "follow moves status"
);
assert(
  data<any>(app.call("customer.get", { id: aPrivate.id }, agentA)).status === "following",
  "status becomes following"
);

const byFollowing = data<any[]>(
  app.call("customer.list", { status: "following" }, manager)
);
assert(
  byFollowing.every((row) => row.status === "following") &&
    byFollowing.some((row) => row.id === aPrivate.id) &&
    !byFollowing.some((row) => row.id === bPrivate.id),
  "filter by status following"
);

const byIntent = data<any[]>(
  app.call("customer.list", { intent: "buy", level: "B", agent_id: agentAId }, manager)
);
assert(
  byIntent.every(
    (row) => row.intent === "buy" && row.level === "B" && row.agent_id === agentAId
  ) && byIntent.some((row) => row.id === bPrivate.id),
  "combined intent/level/agent"
);

const empty = data<any[]>(
  app.call("customer.list", { level: "C", agent_id: agentBId }, manager)
);
assert(!empty.some((row) => [aPrivate.id, bPrivate.id, bOther.id].includes(row.id)), "empty combo");

const byVisibility = data<any[]>(
  app.call("customer.list", { visibility: "private", status: "new" }, manager)
);
assert(
  byVisibility.every((row) => row.visibility === "private" && row.status === "new") &&
    byVisibility.some((row) => row.id === bPrivate.id),
  "visibility + status"
);

console.log(`Customer list filters smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
