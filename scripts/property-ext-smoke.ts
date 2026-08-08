import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const mediaPath = path.resolve("data", "property-ext-media.bin");
fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
fs.writeFileSync(mediaPath, "fake panorama media", "utf8");
const app = createApp(seedDatabase(path.resolve("data", "property-ext-smoke.db")).dbPath);
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

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const finance = login("finance");
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "房源扩展测试盘",
    deal_type: "sale",
    community: "扩展花园",
    price: 320,
    owner_name: "业主周七",
    owner_phone: "13780000001",
    status: "available",
  },
  agent
);
check(house.ok, "create house for property ext");
const houseId = data<any>(house).id;

check(
  !app.call("propertyExt.locks.set", { id: houseId, locked: true, reason: "短" }, agent).ok,
  "lock requires meaningful reason"
);
check(
  !app.call(
    "propertyExt.locks.set",
    { id: houseId, locked: true, reason: "重点保护", lock_until: "2000-01-01" },
    agent
  ).ok,
  "lock rejects past unlock date"
);
check(
  app.call(
    "propertyExt.locks.set",
    {
      id: houseId,
      locked: true,
      reason: "重点盘保护",
      lock_until: "2099-12-31",
    },
    agent
  ).ok,
  "agent locks house with reason"
);
const locks = app.call("propertyExt.locks.list", {}, manager);
check(
  locks.ok &&
    data<any[]>(locks).some(
      (row) => row.id === houseId && row.lock_reason === "重点盘保护"
    ),
  "manager lists locked houses"
);
check(
  !app.call("propertyExt.locks.list", {}, finance).ok,
  "finance cannot list locks"
);
check(
  app.call(
    "house.lock",
    { id: houseId, locked: false, reason: "保护期结束解锁" },
    agent
  ).ok,
  "house.lock unlock still works via propertyExt"
);

check(
  !app.call(
    "propertyExt.cooperations.create",
    { house_id: houseId, partner_name: "合", share_ratio: 120 },
    agent
  ).ok,
  "cooperation validates partner and share"
);
const coop = app.call(
  "propertyExt.cooperations.create",
  {
    house_id: houseId,
    partner_user_id: peerId,
    partner_name: "同店合作经纪人",
    share_ratio: 30,
    note: "联合开发",
  },
  agent
);
check(coop.ok, "create house cooperation");
const coopId = data<any>(coop).id;
const peerMessages = app.call("message.list", {}, peer);
check(
  peerMessages.ok &&
    data<any[]>(peerMessages).some((message) => message.kind === "house_cooperation"),
  "cooperation notifies partner"
);
check(
  !app.call(
    "propertyExt.cooperations.create",
    {
      house_id: houseId,
      partner_user_id: peerId,
      partner_name: "同店合作经纪人",
      share_ratio: 30,
    },
    agent
  ).ok,
  "duplicate active cooperation blocked"
);
check(
  app.call(
    "propertyExt.cooperations.end",
    { id: coopId, reason: "合作到期结束" },
    agent
  ).ok,
  "end house cooperation"
);

check(
  !app.call(
    "propertyExt.media.add",
    {
      house_id: houseId,
      media_type: "photo",
      title: "无效",
      local_path: mediaPath,
    },
    agent
  ).ok,
  "media rejects invalid type"
);
const media = app.call(
  "propertyExt.media.add",
  {
    house_id: houseId,
    media_type: "panorama",
    title: "客厅全景",
    local_path: mediaPath,
  },
  agent
);
check(media.ok, "add panorama media");
const mediaId = data<any>(media).id;
const mediaList = app.call(
  "propertyExt.media.list",
  { house_id: houseId, status: "active" },
  manager
);
check(
  mediaList.ok && data<any[]>(mediaList).some((row) => row.id === mediaId),
  "list active house media"
);
check(
  app.call("propertyExt.media.archive", { id: mediaId }, agent).ok,
  "archive house media"
);

check(
  !app.call(
    "propertyExt.auction.save",
    { house_id: houseId, starting_price: 0 },
    agent
  ).ok,
  "auction rejects zero starting price"
);
check(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: houseId,
      court_name: "本地法院",
      case_no: "拍2026-1",
      starting_price: 200,
      reserve_price: 220,
    },
    agent
  ).ok,
  "save auction profile"
);
check(
  app.call("propertyExt.auction.activate", { house_id: houseId }, agent).ok,
  "activate auction profile"
);
const auctionHouse = app.call("house.get", { id: houseId }, agent);
check(
  auctionHouse.ok && data<any>(auctionHouse).deal_mode === "auction",
  "activating auction sets deal_mode"
);
check(
  app.call("propertyExt.auction.complete", { house_id: houseId }, manager).ok,
  "complete auction"
);

const exclusiveHouse = app.call(
  "house.create",
  {
    title: "独家包销测试盘",
    deal_type: "sale",
    community: "扩展花园",
    price: 280,
    owner_name: "业主吴八",
    owner_phone: "13780000002",
    status: "available",
  },
  agent
);
check(exclusiveHouse.ok, "create house for exclusive");
const exclusiveHouseId = data<any>(exclusiveHouse).id;
check(
  !app.call(
    "propertyExt.exclusive.save",
    {
      house_id: exclusiveHouseId,
      agency_type: "package",
      start_date: "2026-08-01",
      end_date: "2026-07-01",
      package_price: 250,
    },
    agent
  ).ok,
  "exclusive rejects inverted dates"
);
check(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: exclusiveHouseId,
      agency_type: "package",
      start_date: "2026-08-01",
      end_date: "2027-08-01",
      package_price: 250,
      commission_rule: "包销差价归门店",
    },
    agent
  ).ok,
  "save exclusive package profile"
);
check(
  app.call(
    "propertyExt.exclusive.activate",
    { house_id: exclusiveHouseId },
    agent
  ).ok,
  "activate exclusive package"
);
const exclusiveLoaded = app.call(
  "house.get",
  { id: exclusiveHouseId },
  agent
);
check(
  exclusiveLoaded.ok && data<any>(exclusiveLoaded).deal_mode === "exclusive",
  "activating exclusive sets deal_mode"
);
check(
  app.call(
    "propertyExt.exclusive.end",
    { house_id: exclusiveHouseId, reason: "包销到期结束" },
    manager
  ).ok,
  "end exclusive package"
);
const afterEnd = app.call("house.get", { id: exclusiveHouseId }, agent);
check(
  afterEnd.ok && data<any>(afterEnd).deal_mode === "normal",
  "ending exclusive restores normal deal_mode"
);

check(
  !app.call(
    "suite.create",
    {
      module: "property_ext",
      record_type: "listing_lock",
      title: "旧通用锁定盘",
    },
    manager
  ).ok,
  "generic suite listing_lock removed"
);
check(
  !app.call(
    "suite.create",
    {
      module: "property_ext",
      record_type: "cooperation",
      title: "旧通用合作盘",
    },
    manager
  ).ok,
  "generic suite cooperation removed"
);
check(
  !app.call(
    "suite.create",
    {
      module: "property_ext",
      record_type: "auction",
      title: "旧通用拍卖",
    },
    manager
  ).ok,
  "generic suite auction removed"
);

console.log(`Property ext smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
