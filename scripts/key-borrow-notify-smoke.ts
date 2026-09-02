import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "key-borrow-notify-smoke.db")).dbPath
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
const borrowMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "key_borrow" && m.title === "钥匙已借出"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const peerName = data<any>(app.call("auth.me", {}, peer)).display_name;

let phoneSeq = 840;
let keySeq = 0;
function createHouse(token: string, title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "钥匙借出小区",
      price: 210,
      owner_name: "借出业主",
      owner_phone: `13780${String(phoneSeq).padStart(6, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function registerKey(houseId: string, keeperId: string) {
  keySeq += 1;
  const registered = app.call(
    "property.keys.register",
    {
      house_id: houseId,
      key_no: `KEY-BORROW-${keySeq}`,
      keeper_user_id: keeperId,
    },
    manager
  );
  assert(registered.ok, `register KEY-BORROW-${keySeq}`);
  return { keyId: data<any>(registered).id, keyNo: `KEY-BORROW-${keySeq}` };
}

assert(
  !app.call("property.keys.borrow", { id: "missing" }, manager).ok,
  "cannot borrow missing key"
);

const houseTitle = "钥匙借出通知盘";
const houseId = createHouse(agent, houseTitle);
const first = registerKey(houseId, peerId);

const beforePeer = borrowMsgs(peer).length;
const beforeAgent = borrowMsgs(agent).length;
const beforeManager = borrowMsgs(manager).length;
const borrowed = app.call(
  "property.keys.borrow",
  {
    id: first.keyId,
    borrower_user_id: peerId,
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
  },
  manager
);
assert(borrowed.ok, "manager borrows key for peer");
assert(borrowMsgs(peer).length === beforePeer + 1, "keeper/borrower receives borrow");
assert(borrowMsgs(agent).length === beforeAgent + 1, "house agent receives borrow");
assert(borrowMsgs(manager).length === beforeManager, "actor skips self");
assert(
  borrowMsgs(peer).some(
    (m) =>
      m.ref_id === first.keyId &&
      m.ref_type === "house_key" &&
      String(m.body).includes(houseTitle) &&
      String(m.body).includes(first.keyNo) &&
      String(m.body).includes(peerName)
  ),
  "borrow message body"
);
assert(
  !app.call("property.keys.borrow", { id: first.keyId, borrower_user_id: peerId }, manager)
    .ok,
  "cannot re-borrow borrowed key"
);

const second = registerKey(houseId, peerId);
const beforeSelfAgent = borrowMsgs(agent).length;
const beforeSelfPeer = borrowMsgs(peer).length;
assert(
  app.call("property.keys.borrow", { id: second.keyId }, agent).ok,
  "agent self-borrows"
);
assert(borrowMsgs(agent).length === beforeSelfAgent, "self-borrow skips agent");
assert(borrowMsgs(peer).length === beforeSelfPeer + 1, "keeper still notified on self-borrow");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, peer).ok,
  "mute house"
);
const third = registerKey(houseId, peerId);
const beforeMutePeer = borrowMsgs(peer).length;
const beforeMuteAgent = borrowMsgs(agent).length;
assert(
  app.call(
    "property.keys.borrow",
    { id: third.keyId, borrower_user_id: peerId },
    manager
  ).ok,
  "borrow while muted"
);
assert(borrowMsgs(peer).length === beforeMutePeer, "muted house suppresses borrow");
assert(
  borrowMsgs(agent).length === beforeMuteAgent + 1,
  "house agent still notified while peer muted"
);

console.log(`Key borrow notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
