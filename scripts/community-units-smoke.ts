import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "community-units-smoke.db")).dbPath);
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

const agent = login("agent_a");
const finance = login("finance");

const community = app.call(
  "property.communities.upsert",
  {
    name: "房号字典花园",
    district: "高新片区",
    address: "科技路 1 号",
    building_count: 6,
  },
  agent
);
check(community.ok, "create community for units");
const communityId = data<any>(community).id;

const other = app.call(
  "property.communities.upsert",
  {
    name: "对照小区",
    district: "经开片区",
    address: "经开大道 9 号",
    building_count: 3,
  },
  agent
);
check(other.ok, "create other district community");

const districts = app.call("property.districts.list", {}, agent);
check(
  districts.ok &&
    data<string[]>(districts).includes("高新片区") &&
    data<string[]>(districts).includes("经开片区"),
  "list business districts from communities"
);

const filtered = app.call(
  "property.communities.list",
  { district: "高新片区" },
  agent
);
check(
  filtered.ok &&
    data<any[]>(filtered).every((item) => item.district === "高新片区") &&
    data<any[]>(filtered).some((item) => item.id === communityId),
  "filter communities by business district"
);

check(!app.call("property.units.list", { community_id: communityId }, finance).ok, "finance cannot list units");
check(
  !app.call(
    "property.units.upsert",
    { community_id: communityId, room_no: "101" },
    finance
  ).ok,
  "finance cannot upsert units"
);

const unit = app.call(
  "property.units.upsert",
  {
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
    orientation: "南北",
    area_size: 89.5,
    build_area: 105,
    remark: "样板间",
  },
  agent
);
check(unit.ok, "create community unit with area and orientation");
const unitId = data<any>(unit).id;

const listed = app.call("property.units.list", { community_id: communityId }, agent);
check(
  listed.ok &&
    data<any[]>(listed).some(
      (item) =>
        item.id === unitId &&
        item.label === "3-2-1801" &&
        item.orientation === "南北" &&
        Number(item.area_size) === 89.5 &&
        Number(item.build_area) === 105
    ),
  "list unit with label area orientation"
);

const conflict = app.call(
  "property.units.checkConflict",
  {
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
  },
  agent
);
check(
  conflict.ok && data<any>(conflict).conflict === true && data<any>(conflict).unit?.id === unitId,
  "detect same-room conflict"
);

const duplicate = app.call(
  "property.units.upsert",
  {
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
  },
  agent
);
check(!duplicate.ok && duplicate.code === 409, "reject duplicate room registration");

const noConflict = app.call(
  "property.units.checkConflict",
  {
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
    exclude_id: unitId,
  },
  agent
);
check(noConflict.ok && data<any>(noConflict).conflict === false, "exclude self from conflict check");

const updated = app.call(
  "property.units.upsert",
  {
    id: unitId,
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
    orientation: "南",
    area_size: 90,
    build_area: 106,
  },
  agent
);
check(updated.ok, "update community unit");
const afterUpdate = data<any[]>(
  app.call("property.units.list", { community_id: communityId }, agent)
).find((item) => item.id === unitId);
check(afterUpdate?.orientation === "南" && Number(afterUpdate?.area_size) === 90, "persist unit update");

const communities = app.call("property.communities.list", { keyword: "房号字典" }, agent);
const communityRow = data<any[]>(communities).find((item) => item.id === communityId);
check(communityRow && Number(communityRow.unit_count) === 1, "community list shows unit_count");

check(app.call("property.units.remove", { id: unitId }, agent).ok, "soft remove community unit");
const afterRemove = app.call("property.units.list", { community_id: communityId }, agent);
check(
  afterRemove.ok && !data<any[]>(afterRemove).some((item) => item.id === unitId),
  "removed unit hidden from active list"
);
const clearedConflict = app.call(
  "property.units.checkConflict",
  {
    community_id: communityId,
    building: "3",
    unit_no: "2",
    room_no: "1801",
  },
  agent
);
check(clearedConflict.ok && data<any>(clearedConflict).conflict === false, "removed unit frees room key");

check(
  !app.call(
    "property.units.upsert",
    { community_id: communityId, room_no: "" },
    agent
  ).ok,
  "room number required"
);

console.log(`Community units smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
