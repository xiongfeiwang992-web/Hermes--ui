import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-rooms-floor-smoke.db")).dbPath);
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

const created = app.call(
  "house.create",
  {
    title: "户型楼层盘",
    deal_type: "sale",
    community: "楼层苑",
    district: "城南",
    price: 268,
    owner_name: "业主",
    owner_phone: "13680007001",
    area_size: 96.5,
    rooms: "3室2厅",
    floor: "8/18",
    address: "楼层苑 3 栋",
    status: "available",
  },
  agent
);
assert(created.ok, "create with rooms/floor/district");
const houseId = data<any>(created).id;
assert(data<any>(created).rooms === "3室2厅", "rooms persisted");
assert(data<any>(created).floor === "8/18", "floor persisted");
assert(data<any>(created).district === "城南", "district persisted");
assert(data<any>(created).area_size === 96.5, "area persisted");

const got = data<any>(app.call("house.get", { id: houseId }, agent));
assert(got.rooms === "3室2厅" && got.floor === "8/18", "get returns rooms/floor");
assert(got.district === "城南" && got.area_size === 96.5, "get returns district/area");

const listed = data<any[]>(app.call("house.list", { community: "楼层苑" }, manager));
const row = listed.find((item) => item.id === houseId);
assert(Boolean(row), "listed in community filter");
assert(
  row.rooms === "3室2厅" && row.floor === "8/18" && row.district === "城南",
  "list exposes rooms/floor/district"
);

const plain = app.call(
  "house.create",
  {
    title: "未填户型盘",
    deal_type: "rent",
    community: "楼层苑",
    price: 3200,
    owner_name: "业主乙",
    owner_phone: "13680007002",
    status: "available",
  },
  agent
);
assert(plain.ok, "create without rooms/floor/district");
assert(
  data<any>(plain).rooms == null &&
    data<any>(plain).floor == null &&
    data<any>(plain).district == null,
  "optional fields null"
);

const updated = app.call(
  "house.update",
  {
    id: houseId,
    rooms: "4室2厅",
    floor: "12/18",
    district: "城东",
    area_size: 118,
  },
  agent
);
assert(updated.ok, "update rooms/floor/district");
const after = data<any>(app.call("house.get", { id: houseId }, agent));
assert(after.rooms === "4室2厅", "updated rooms");
assert(after.floor === "12/18", "updated floor");
assert(after.district === "城东" && after.area_size === 118, "updated district/area");

console.log(`House rooms/floor smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
