import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-media-owner-smoke.db")).dbPath);
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
const agentA = login("agent_a");
const agentB = login("agent_b");

const dashboard = data<any>(app.call("report.dashboard", {}, agentA));
assert(dashboard.company_name === "示例房产", "dashboard company name");
assert(Number(dashboard.store_count) === 2, "dashboard store count");
assert(Number(dashboard.employee_count) === 6, "dashboard employee count");

const houseA = app.call(
  "house.create",
  {
    title: "同业主一号盘",
    deal_type: "sale",
    community: "业主苑",
    price: 220,
    owner_name: "张业主",
    owner_phone: "13770001111",
    status: "available",
  },
  agentA
);
assert(houseA.ok, "create first related house");
const houseAId = data<any>(houseA).id;

const houseB = app.call(
  "house.create",
  {
    title: "同业主二号盘",
    deal_type: "rent",
    community: "业主苑",
    price: 4500,
    owner_name: "张业主",
    owner_phone: "13770001111",
    status: "available",
  },
  agentA
);
assert(houseB.ok, "create second related house");
const houseBId = data<any>(houseB).id;

const houseC = app.call(
  "house.create",
  {
    title: "其他业主盘",
    deal_type: "sale",
    community: "别苑",
    price: 180,
    owner_name: "李业主",
    owner_phone: "13770002222",
    status: "available",
  },
  agentB
);
assert(houseC.ok, "create unrelated house");

const related = data<any>(app.call("house.relatedByOwner", { id: houseAId }, agentA));
assert(related.related_count === 1, "related count excludes self");
assert(
  related.items.some((item: any) => item.id === houseBId) &&
    !related.items.some((item: any) => item.id === data<any>(houseC).id),
  "related items match same owner phone"
);

const photoPath = path.resolve("data", "house-photo-fixture.txt");
fs.writeFileSync(photoPath, "photo fixture", "utf8");
const photo = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseAId,
    category: "photo",
    name: "客厅.txt",
    local_path: photoPath,
  },
  agentA
);
assert(photo.ok, "add house photo");
const photoId = data<any>(photo).id;

assert(
  data<any[]>(
    app.call("attachment.list", { parent_type: "house", parent_id: houseAId }, agentA)
  ).some((item) => item.id === photoId),
  "list includes photo"
);

assert(
  !app.call("attachment.delete", { id: photoId }, agentA).ok,
  "delete without reason rejected"
);
assert(
  !app.call("attachment.delete", { id: photoId, reason: "x" }, agentA).ok,
  "delete with too-short reason rejected"
);
assert(
  !app.call("attachment.delete", { id: photoId, reason: "误传图片需要删除" }, agentB).ok,
  "non-holder cannot delete house photo"
);

const deleted = app.call(
  "attachment.delete",
  { id: photoId, reason: "光线不佳重新拍摄" },
  agentA
);
assert(deleted.ok, "holder deletes photo with reason");
assert(
  data<any[]>(
    app.call("attachment.list", { parent_type: "house", parent_id: houseAId }, agentA)
  ).every((item) => item.id !== photoId),
  "deleted photo hidden from list"
);

const audits = data<any[]>(app.call("audit.list", { action: "attachment.delete" }, admin));
assert(
  audits.some((row) => {
    try {
      const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
      return row.target_id === photoId && detail?.reason === "光线不佳重新拍摄";
    } catch {
      return false;
    }
  }),
  "audit records delete reason"
);

const coverPath = path.resolve("data", "house-cover-fixture.txt");
fs.writeFileSync(coverPath, "cover fixture", "utf8");
const cover = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseAId,
    category: "cover",
    name: "封面.txt",
    local_path: coverPath,
  },
  agentA
);
assert(cover.ok, "add cover attachment");
assert(
  app.call(
    "house.update",
    { id: houseAId, cover_image: coverPath },
    agentA
  ).ok,
  "set house cover image"
);
assert(
  app.call(
    "attachment.delete",
    { id: data<any>(cover).id, reason: "更换封面图" },
    agentA
  ).ok,
  "delete cover attachment"
);
assert(
  data<any>(app.call("house.get", { id: houseAId }, agentA)).cover_image == null,
  "cover_image cleared after delete"
);

assert(
  !app.call("house.relatedByOwner", { id: houseAId }, login("finance")).ok,
  "finance cannot query related houses"
);

console.log(`House media/owner smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
