import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "dividend-calculated-notify-smoke.db")).dbPath
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
const calcMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "performance" && m.title === "利润分红已核算"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const periodMonth = new Date().toISOString().slice(0, 7);

assert(
  app.call(
    "performance.points.create",
    { user_id: agentId, points: 10, reason: "核算通知积分A" },
    admin
  ).ok,
  "admin grants agent points"
);
assert(
  app.call(
    "performance.points.create",
    { user_id: peerId, points: 10, reason: "核算通知积分B" },
    admin
  ).ok,
  "admin grants peer points"
);

assert(
  !app.call(
    "performance.dividend.create",
    { period_month: periodMonth, pool_amount: 2000 },
    manager
  ).ok,
  "manager cannot create dividend"
);

assert(
  app.call("message.subscriptions.save", { channels: { performance: false } }, peer).ok,
  "mute performance for peer"
);

const beforeAgent = calcMsgs(agent).length;
const beforePeer = calcMsgs(peer).length;
const beforeAdmin = calcMsgs(admin).length;
const dividend = app.call(
  "performance.dividend.create",
  { period_month: periodMonth, pool_amount: 2000 },
  admin
);
assert(dividend.ok, "admin creates dividend batch");
assert(data<any>(dividend).status === "calculated", "status calculated");
assert(data<any>(dividend).total_points === 20, "total points 20");
const batchId = data<any>(dividend).id;
assert(calcMsgs(agent).length === beforeAgent + 1, "agent receives calculated message");
assert(calcMsgs(peer).length === beforePeer, "muted peer suppresses calculated message");
assert(calcMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  calcMsgs(agent).some(
    (m) =>
      m.ref_id === batchId &&
      String(m.body).includes(periodMonth) &&
      String(m.body).includes("1000") &&
      String(m.body).includes("积分 10")
  ),
  "calculated message body"
);

assert(
  !app.call(
    "performance.dividend.create",
    { period_month: periodMonth, pool_amount: 1000 },
    admin
  ).ok,
  "duplicate month batch blocked"
);

console.log(
  `Dividend calculated notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
