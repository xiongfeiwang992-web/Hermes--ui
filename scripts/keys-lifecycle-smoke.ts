import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "keys-lifecycle-smoke.db")).dbPath);
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

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentB = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "钥匙终态房",
    deal_type: "sale",
    community: "钥匙苑",
    price: 180,
    owner_name: "业主",
    owner_phone: "13770001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const register = (no: string) =>
  app.call(
    "property.keys.register",
    { house_id: houseId, key_no: no, keeper_user_id: agentId },
    agent
  );

const keyOwner = register("K-OWNER-001");
assert(keyOwner.ok, "register return-owner key");
const ownerKeyId = data<any>(keyOwner).id;

assert(
  !app.call("property.keys.returnOwner", { id: ownerKeyId }, agent).ok,
  "agent cannot return owner"
);
assert(
  !app.call("property.keys.external", { id: ownerKeyId, reason: "外司成交" }, agent).ok,
  "agent cannot mark external"
);

const returned = app.call("property.keys.returnOwner", { id: ownerKeyId, reason: "" }, manager);
assert(returned.ok && data<any>(returned).status === "returned_owner", "manager return to owner");

const ownerRow = (data<any[]>(app.call("property.keys.list", { status: "returned_owner" }, manager)) || []).find(
  (row) => row.id === ownerKeyId
);
assert(
  ownerRow &&
    ownerRow.status === "returned_owner" &&
    ownerRow.closed_at &&
    ownerRow.closed_by &&
    ownerRow.invalid_reason === "归还业主",
  "returned_owner fields persisted"
);

assert(
  !app.call("property.keys.borrow", { id: ownerKeyId }, agent).ok,
  "cannot borrow after return owner"
);
assert(
  !app.call("property.keys.returnOwner", { id: ownerKeyId }, manager).ok,
  "cannot re-close returned_owner"
);

const keyExt = register("K-EXT-001");
assert(keyExt.ok, "register external key");
const extKeyId = data<any>(keyExt).id;
assert(
  !app.call("property.keys.external", { id: extKeyId, reason: "" }, manager).ok,
  "external requires reason"
);
assert(
  app.call("property.keys.external", { id: extKeyId, reason: "外司渠道成交" }, manager).ok,
  "manager marks external"
);
assert(
  data<any[]>(app.call("property.keys.list", { status: "external" }, admin)).some(
    (row) => row.id === extKeyId && row.invalid_reason === "外司渠道成交"
  ),
  "external list filter"
);
assert(!app.call("property.keys.borrow", { id: extKeyId }, agent).ok, "cannot borrow external key");

const keyBorrowed = register("K-BORROW-001");
assert(keyBorrowed.ok, "register borrow key");
const borrowKeyId = data<any>(keyBorrowed).id;
assert(app.call("property.keys.borrow", { id: borrowKeyId }, agent).ok, "borrow key");
assert(
  !app.call("property.keys.returnOwner", { id: borrowKeyId }, manager).ok,
  "borrowed cannot return owner"
);
assert(
  !app.call("property.keys.external", { id: borrowKeyId, reason: "先还再说" }, manager).ok,
  "borrowed cannot external"
);
assert(
  !app.call("property.keys.invalidate", { id: borrowKeyId, reason: "丢了" }, manager).ok,
  "borrowed cannot invalidate"
);
assert(app.call("property.keys.return", { id: borrowKeyId }, agent).ok, "return borrowed key");
assert(
  app.call("property.keys.invalidate", { id: borrowKeyId, reason: "钥匙损坏" }, manager).ok,
  "invalidate after return"
);

const audit = app.call("audit.list", { action: "key.return_owner", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "key.return_owner"),
  "return owner audit"
);
const extAudit = app.call("audit.list", { action: "key.external", limit: 20 }, admin);
assert(
  extAudit.ok && (data<any[]>(extAudit) || []).some((row) => row.action === "key.external"),
  "external audit"
);

const messages = app.call("message.list", {}, agent);
assert(
  messages.ok &&
    (data<any[]>(messages) || []).some(
      (row) => row.kind === "key_return_owner" || row.kind === "key_external" || row.kind === "key_invalidate"
    ),
  "keeper/agent receives key close message"
);

// cross-store isolation: other store manager cannot close
const other = login("agent_c");
const otherHouse = app.call(
  "house.create",
  {
    title: "他店钥匙房",
    deal_type: "rent",
    community: "跨店苑",
    price: 40,
    owner_name: "业主B",
    owner_phone: "13770001002",
    status: "available",
  },
  other
);
assert(otherHouse.ok, "create other-store house");
const otherKey = app.call(
  "property.keys.register",
  { house_id: data<any>(otherHouse).id, key_no: "K-OTHER-001" },
  other
);
assert(otherKey.ok, "register other-store key");
assert(
  !app.call(
    "property.keys.returnOwner",
    { id: data<any>(otherKey).id },
    manager
  ).ok,
  "manager cannot close other store key"
);

assert(
  !app.call(
    "property.keys.returnOwner",
    { id: data<any>(otherKey).id },
    agentB
  ).ok,
  "peer agent cannot close"
);

console.log(`Keys lifecycle smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
