import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "call-unmatched-notify-smoke.db")).dbPath
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
const unmatchedMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      String(m.title).includes("未匹配客源房源")
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");

assert(
  !app.call(
    "officeCollab.calls.create",
    { phone: "13690009999", direction: "in", called_at: "2026-09-01T10:00:00.000Z" },
    finance
  ).ok,
  "finance cannot create call"
);

const beforeAdmin = unmatchedMsgs(admin).length;
const beforeManager = unmatchedMsgs(manager).length;
const beforeAgent = unmatchedMsgs(agent).length;
const created = app.call(
  "officeCollab.calls.create",
  {
    phone: "13690009999",
    direction: "in",
    called_at: "2026-09-01T10:00:00.000Z",
    note: "陌生来电",
  },
  agent
);
assert(created.ok, "agent logs unmatched call");
assert(!data<any>(created).matched_house_id, "no house match");
assert(!data<any>(created).matched_customer_id, "no customer match");
const callId = data<any>(created).id;
assert(unmatchedMsgs(admin).length === beforeAdmin + 1, "admin receives unmatched message");
assert(
  unmatchedMsgs(manager).length === beforeManager + 1,
  "manager receives unmatched message"
);
assert(unmatchedMsgs(agent).length === beforeAgent, "logger skips self");
assert(
  unmatchedMsgs(manager).some(
    (m) =>
      m.ref_id === callId &&
      m.title === "来电未匹配客源房源" &&
      String(m.body).includes("13690009999")
  ),
  "unmatched message body"
);

const house = app.call(
  "house.create",
  {
    title: "已匹配房源",
    deal_type: "sale",
    community: "匹配苑",
    price: 180,
    owner_name: "匹配业主",
    owner_phone: "13690008888",
    status: "available",
  },
  agent
);
assert(house.ok, "create matched house");
const beforeMatched = unmatchedMsgs(manager).length;
const matched = app.call(
  "officeCollab.calls.create",
  {
    phone: "13690008888",
    direction: "out",
    called_at: "2026-09-01T11:00:00.000Z",
  },
  agent
);
assert(matched.ok, "log matched call");
assert(data<any>(matched).matched_house_id, "house matched");
assert(
  unmatchedMsgs(manager).length === beforeMatched,
  "matched call does not send unmatched message"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = unmatchedMsgs(manager).length;
assert(
  app.call(
    "officeCollab.calls.create",
    {
      phone: "13690007777",
      direction: "in",
      called_at: "2026-09-01T12:00:00.000Z",
    },
    agent
  ).ok,
  "log while muted"
);
assert(unmatchedMsgs(manager).length === beforeMute, "muted other suppresses unmatched message");

console.log(`Call unmatched notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
