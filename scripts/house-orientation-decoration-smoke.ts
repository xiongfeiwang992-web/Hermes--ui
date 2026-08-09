import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-orientation-decoration-smoke.db")).dbPath
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

const agent = login("agent_a");
const manager = login("manager");

assert(
  !app.call(
    "house.create",
    {
      title: "无效朝向",
      deal_type: "sale",
      community: "朝向苑",
      price: 200,
      owner_name: "业主",
      owner_phone: "13680004701",
      orientation: "diagonal",
      status: "available",
    },
    agent
  ).ok,
  "reject invalid orientation"
);
assert(
  !app.call(
    "house.create",
    {
      title: "无效装修",
      deal_type: "sale",
      community: "朝向苑",
      price: 200,
      owner_name: "业主",
      owner_phone: "13680004702",
      decoration: "gold_leaf",
      status: "available",
    },
    agent
  ).ok,
  "reject invalid decoration"
);

const created = app.call(
  "house.create",
  {
    title: "朝向装修盘",
    deal_type: "sale",
    community: "朝向苑",
    price: 288,
    owner_name: "业主",
    owner_phone: "13680004703",
    area_size: 98,
    orientation: "south_north",
    decoration: "fine",
    status: "available",
  },
  agent
);
assert(created.ok, "create with orientation/decoration");
const houseId = data<any>(created).id;
assert(data<any>(created).orientation === "south_north", "orientation persisted");
assert(data<any>(created).decoration === "fine", "decoration persisted");
assert(data<any>(created).orientation_label === "南北", "orientation label");
assert(data<any>(created).decoration_label === "精装", "decoration label");

const empty = app.call(
  "house.create",
  {
    title: "未填朝向装修",
    deal_type: "rent",
    community: "朝向苑",
    price: 4500,
    owner_name: "业主乙",
    owner_phone: "13680004704",
    status: "available",
  },
  agent
);
assert(empty.ok, "create without orientation/decoration");
assert(
  data<any>(empty).orientation == null && data<any>(empty).decoration == null,
  "optional fields null"
);

const byOrient = data<any[]>(
  app.call("house.list", { orientation: "south_north" }, manager)
);
assert(
  byOrient.every((row) => row.orientation === "south_north") &&
    byOrient.some((row) => row.id === houseId),
  "filter by orientation"
);

const byDeco = data<any[]>(app.call("house.list", { decoration: "fine" }, manager));
assert(
  byDeco.every((row) => row.decoration === "fine") && byDeco.some((row) => row.id === houseId),
  "filter by decoration"
);

const combo = data<any[]>(
  app.call("house.list", { orientation: "south_north", decoration: "fine" }, manager)
);
assert(combo.some((row) => row.id === houseId), "combined filter");

const updated = app.call(
  "house.update",
  { id: houseId, orientation: "southeast", decoration: "simple" },
  agent
);
assert(updated.ok, "update orientation/decoration");
const got = data<any>(app.call("house.get", { id: houseId }, agent));
assert(got.orientation === "southeast" && got.orientation_label === "东南", "updated orientation");
assert(got.decoration === "simple" && got.decoration_label === "简装", "updated decoration");

assert(
  !app.call("house.update", { id: houseId, orientation: "bad" }, agent).ok,
  "update rejects bad orientation"
);

const cleared = app.call(
  "house.update",
  { id: houseId, orientation: "", decoration: "" },
  agent
);
assert(cleared.ok, "clear orientation/decoration");
const clearedRow = data<any>(app.call("house.get", { id: houseId }, agent));
assert(clearedRow.orientation == null && clearedRow.decoration == null, "fields cleared");

console.log(`House orientation/decoration smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
