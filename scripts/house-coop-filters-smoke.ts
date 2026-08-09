import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-coop-filters-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const publicHouse = app.call(
  "house.create",
  {
    title: "公盘筛选房源",
    deal_type: "sale",
    community: "筛选小区",
    price: 200,
    owner_name: "公盘业主",
    owner_phone: "13761000001",
    status: "available",
    is_private: false,
  },
  agentA
);
check(publicHouse.ok, "create public pool house");
const publicId = data<any>(publicHouse).id;

const privateHouse = app.call(
  "house.create",
  {
    title: "私盘筛选房源",
    deal_type: "sale",
    community: "筛选小区",
    price: 210,
    owner_name: "私盘业主",
    owner_phone: "13761000002",
    status: "available",
    is_private: true,
  },
  agentA
);
check(privateHouse.ok, "create private pool house");
const privateId = data<any>(privateHouse).id;

const plainHouse = app.call(
  "house.create",
  {
    title: "无合作房源",
    deal_type: "rent",
    community: "筛选小区",
    price: 3500,
    owner_name: "出租业主",
    owner_phone: "13761000003",
    status: "available",
  },
  agentB
);
check(plainHouse.ok, "create non-coop house");
const plainId = data<any>(plainHouse).id;

check(
  app.call("house.lock", { id: publicId, locked: true, reason: "筛选锁定保护" }, agentA).ok,
  "lock public house for filter"
);

const coop = app.call(
  "propertyExt.cooperations.create",
  {
    house_id: publicId,
    partner_user_id: agentBId,
    partner_name: "被合作经纪人",
    share_ratio: 40,
  },
  agentA
);
check(coop.ok, "create cooperation for filter house");

const publicPool = app.call("house.list", { pool: "public" }, agentA);
check(
  publicPool.ok &&
    data<any[]>(publicPool).some((item) => item.id === publicId) &&
    data<any[]>(publicPool).every((item) => !item.is_private),
  "filter public pool houses"
);
const privatePool = app.call("house.list", { pool: "private" }, agentA);
check(
  privatePool.ok &&
    data<any[]>(privatePool).some((item) => item.id === privateId) &&
    data<any[]>(privatePool).every((item) => item.is_private),
  "filter private pool houses"
);

const locked = app.call("house.list", { is_locked: "1" }, agentA);
check(
  locked.ok &&
    data<any[]>(locked).some((item) => item.id === publicId) &&
    data<any[]>(locked).every((item) => item.is_locked),
  "filter locked houses"
);
const unlocked = app.call("house.list", { is_locked: "0" }, agentA);
check(
  unlocked.ok &&
    data<any[]>(unlocked).some((item) => item.id === privateId) &&
    data<any[]>(unlocked).every((item) => !item.is_locked),
  "filter unlocked houses"
);

const active = app.call("house.list", { cooperation: "active" }, agentA);
check(
  active.ok &&
    data<any[]>(active).some((item) => item.id === publicId) &&
    !data<any[]>(active).some((item) => item.id === plainId) &&
    data<any[]>(active).every((item) => item.active_cooperation_count > 0),
  "filter houses with active cooperation"
);

const asOwner = app.call("house.list", { cooperation: "owner" }, agentA);
check(
  asOwner.ok &&
    data<any[]>(asOwner).some((item) => item.id === publicId) &&
    data<any[]>(asOwner).every((item) => item.agent_id === agentAId),
  "filter cooperating houses owned by agent"
);

const asPartner = app.call("house.list", { cooperation: "partner" }, agentB);
check(
  asPartner.ok &&
    data<any[]>(asPartner).some(
      (item) => item.id === publicId && item.cooperation_as_partner === true
    ),
  "filter cooperated houses for partner agent"
);

const ownerAsPartner = app.call("house.list", { cooperation: "partner" }, agentA);
check(
  ownerAsPartner.ok && !data<any[]>(ownerAsPartner).some((item) => item.id === publicId),
  "owner does not appear in partner filter for same house"
);

const managerPartner = app.call("house.list", { cooperation: "partner" }, manager);
check(
  managerPartner.ok && data<any[]>(managerPartner).some((item) => item.id === publicId),
  "store manager sees store partner cooperations"
);

check(
  !app.call("house.list", { cooperation: "unknown" }, agentA).ok,
  "reject invalid cooperation filter"
);

const listed = data<any[]>(app.call("house.list", { keyword: "公盘筛选" }, agentA));
const row = listed.find((item) => item.id === publicId);
check(
  row &&
    row.active_cooperation_count === 1 &&
    row.cooperation_as_owner === true &&
    row.cooperation_as_partner === false,
  "list payload includes cooperation flags"
);

console.log(`House coop filters smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
