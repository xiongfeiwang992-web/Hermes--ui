import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "follow-methods-smoke.db")).dbPath);
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
const agent = login("agent_a");

const defaults = data<any[]>(app.call("config.followMethods", {}, agent));
assert(defaults.length >= 4, "default follow methods available");
assert(
  defaults.some((item) => item.value === "phone" && item.label === "电话"),
  "default includes phone"
);

const house = app.call(
  "house.create",
  {
    title: "跟进方式房源",
    deal_type: "sale",
    community: "字典苑",
    price: 160,
    owner_name: "业主",
    owner_phone: "13330001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const legacy = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: houseId,
    content: "用旧 call 方式登记电话跟进",
    method: "call",
  },
  agent
);
assert(legacy.ok, "legacy call method accepted");
assert(
  data<any[]>(app.call("follow.list", { target_id: houseId }, agent)).some(
    (row) => row.id === data<any>(legacy).id && row.method === "phone" && row.method_label === "电话"
  ),
  "legacy call normalized to phone with label"
);

assert(
  !app.call(
    "follow.create",
    {
      target_type: "house",
      target_id: houseId,
      content: "使用未配置的跟进方式",
      method: "carrier_pigeon",
    },
    agent
  ).ok,
  "reject unknown follow method"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "follow_method", value: "video", label: "视频沟通", sort_order: 5 },
    admin
  ).ok,
  "admin adds video follow method"
);
const methods = data<any[]>(app.call("config.followMethods", {}, agent));
assert(
  methods.some((item) => item.value === "video" && item.label === "视频沟通"),
  "followMethods includes custom video"
);

const videoFollow = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: houseId,
    content: "与业主视频沟通确认看房",
    method: "video",
  },
  agent
);
assert(videoFollow.ok, "create follow with custom method");
assert(
  data<any[]>(app.call("follow.list", { target_id: houseId }, agent)).some(
    (row) =>
      row.id === data<any>(videoFollow).id &&
      row.method === "video" &&
      row.method_label === "视频沟通"
  ),
  "list shows custom method label"
);

const reveal = app.call(
  "contact.reveal",
  {
    target_type: "house",
    target_id: houseId,
    content: "视频确认后查看业主电话号码",
    method: "video",
  },
  agent
);
assert(reveal.ok, "reveal accepts dictionary method");

console.log(`Follow methods smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
