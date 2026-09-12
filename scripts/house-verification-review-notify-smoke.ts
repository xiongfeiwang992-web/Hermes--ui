import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-verification-review-notify-smoke.db")).dbPath
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
const reviewMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "verification_review" &&
      (m.title === "房源验真已通过" || m.title === "房源验真已驳回")
  );
const approvedMsgs = (token: string) =>
  reviewMsgs(token).filter((m) => m.title === "房源验真已通过");
const rejectedMsgs = (token: string) =>
  reviewMsgs(token).filter((m) => m.title === "房源验真已驳回");

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 830;
function createSaleHouse(title: string, token: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "验真审核小区",
      price: 210,
      owner_name: "验真审核业主",
      owner_phone: `1362${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function submitPending(title: string, token: string) {
  const houseId = createSaleHouse(title, token);
  const submitted = app.call(
    "property.verifications.submit",
    {
      house_id: houseId,
      contact_result: "业主确认在售",
      price_confirmed: 210,
      availability_confirmed: true,
    },
    token
  );
  assert(submitted.ok, `submit ${title}`);
  return { houseId, verificationId: data<any>(submitted).id, title };
}

assert(
  !app.call("property.verifications.review", { id: "missing", status: "approved" }, manager)
    .ok,
  "cannot review missing verification"
);

const approveCase = submitPending("验真审核通过盘", agent);
assert(
  !app.call(
    "property.verifications.review",
    { id: approveCase.verificationId, status: "approved" },
    agent
  ).ok,
  "agent cannot review"
);
assert(
  !app.call(
    "property.verifications.review",
    { id: approveCase.verificationId, status: "approved" },
    peer
  ).ok,
  "peer cannot review"
);

const beforeAgent = approvedMsgs(agent).length;
const beforeManager = approvedMsgs(manager).length;
const beforePeer = approvedMsgs(peer).length;
const approved = app.call(
  "property.verifications.review",
  { id: approveCase.verificationId, status: "approved" },
  manager
);
assert(approved.ok, "manager approves verification");
assert(data<any>(approved).status === "approved", "status approved");
assert(approvedMsgs(agent).length === beforeAgent + 1, "submitter receives approved");
assert(approvedMsgs(manager).length === beforeManager, "reviewer skips self");
assert(approvedMsgs(peer).length === beforePeer, "peer not notified on approve");
assert(
  approvedMsgs(agent).some(
    (m) =>
      m.ref_id === approveCase.verificationId &&
      m.ref_type === "house_verification" &&
      String(m.body).includes(approveCase.title)
  ),
  "approved message body includes house"
);

const rejectCase = submitPending("验真审核驳回盘", agent);
assert(
  !app.call(
    "property.verifications.review",
    { id: rejectCase.verificationId, status: "rejected" },
    manager
  ).ok,
  "reject requires reason"
);
const beforeReject = rejectedMsgs(agent).length;
const rejected = app.call(
  "property.verifications.review",
  {
    id: rejectCase.verificationId,
    status: "rejected",
    reason: "电话未接通驳回",
  },
  manager
);
assert(rejected.ok, "manager rejects verification");
assert(rejectedMsgs(agent).length === beforeReject + 1, "submitter receives rejected");
assert(
  rejectedMsgs(agent).some(
    (m) =>
      m.ref_id === rejectCase.verificationId &&
      String(m.body).includes(rejectCase.title) &&
      String(m.body).includes("电话未接通驳回")
  ),
  "rejected message body includes house and reason"
);

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const muteCase = submitPending("静音验真审核盘", agent);
const beforeMute = reviewMsgs(agent).length;
assert(
  app.call(
    "property.verifications.review",
    { id: muteCase.verificationId, status: "approved" },
    manager
  ).ok,
  "approve while muted"
);
assert(reviewMsgs(agent).length === beforeMute, "muted house suppresses review");

const selfCase = submitPending("店长自提自审盘", manager);
const beforeSelf = reviewMsgs(manager).length;
assert(
  app.call(
    "property.verifications.review",
    { id: selfCase.verificationId, status: "approved" },
    manager
  ).ok,
  "manager reviews own verification"
);
assert(reviewMsgs(manager).length === beforeSelf, "self-review skips notify");

console.log(
  `House verification review notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
