import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "org-store-stats-smoke.db")).dbPath);
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
const finance = login("finance");

assert(!app.call("org.stores.list", {}, agent).ok, "agent cannot list stores");
assert(!app.call("org.stores.list", {}, finance).ok, "finance cannot list stores");

const listed = app.call("org.stores.list", {}, admin);
assert(listed.ok, "admin lists stores");
const stores = data<any[]>(listed);
assert(stores.length >= 2, "at least two stores");

const storeA = stores.find((s) => s.name === "一号店");
const storeB = stores.find((s) => s.name === "二号店");
assert(!!storeA && !!storeB, "identify seed stores");

assert(storeA.employee_count === 5, "store A employee_count");
assert(storeA.active_count === 5, "store A active_count");
assert(storeA.inactive_count === 0, "store A inactive_count");
assert(storeA.role_counts?.admin === 1, "store A admin count");
assert(storeA.role_counts?.store_manager === 1, "store A manager count");
assert(storeA.role_counts?.agent === 2, "store A agent count");
assert(storeA.role_counts?.finance === 1, "store A finance count");

assert(storeB.employee_count === 1, "store B employee_count");
assert(storeB.active_count === 1, "store B active_count");
assert(storeB.role_counts?.agent === 1, "store B agent count");
assert((storeB.role_counts?.store_manager || 0) === 0, "store B no manager");

const managerList = app.call("org.stores.list", {}, manager);
assert(managerList.ok, "manager lists own store");
const managerStores = data<any[]>(managerList);
assert(managerStores.length === 1, "manager sees one store");
assert(managerStores[0]!.id === storeA.id, "manager store is store A");
assert(managerStores[0]!.employee_count === 5, "manager sees store A headcount");
assert(
  managerStores[0]!.role_counts?.agent === 2 && managerStores[0]!.role_counts?.finance === 1,
  "manager sees role distribution"
);

const created = app.call(
  "org.users.upsert",
  {
    account: "agent_stats_x",
    display_name: "统计经纪人",
    role: "agent",
    store_id: storeB.id,
    password: "12345678",
  },
  admin
);
assert(created.ok, "create user on store B");
const afterCreate = data<any[]>(app.call("org.stores.list", {}, admin)).find(
  (s) => s.id === storeB.id
);
assert(afterCreate?.employee_count === 2, "store B count increases");
assert(afterCreate?.role_counts?.agent === 2, "store B agent count increases");

const disable = app.call(
  "org.users.upsert",
  {
    id: data<any>(created).id,
    account: "agent_stats_x",
    display_name: "统计经纪人",
    role: "agent",
    store_id: storeB.id,
    status: "disabled",
  },
  admin
);
assert(disable.ok, "disable user");
const afterDisable = data<any[]>(app.call("org.stores.list", {}, admin)).find(
  (s) => s.id === storeB.id
);
assert(afterDisable?.employee_count === 2, "disabled still counted in employee_count");
assert(afterDisable?.active_count === 1, "active_count excludes disabled");
assert(afterDisable?.inactive_count === 1, "inactive_count includes disabled");

const emptyStore = app.call(
  "org.stores.upsert",
  { name: "空门店统计", address: "测试路" },
  admin
);
assert(emptyStore.ok, "create empty store");
const empty = data<any[]>(app.call("org.stores.list", {}, admin)).find(
  (s) => s.id === data<any>(emptyStore).id
);
assert(empty?.employee_count === 0 && empty?.active_count === 0, "empty store zero counts");
assert(
  empty?.role_counts?.agent === 0 && empty?.role_counts?.admin === 0,
  "empty store zero role counts"
);

console.log(`Org store stats smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
