import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "view-feedbacks-smoke.db")).dbPath);
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
const manager = login("manager");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const defaults = data<any[]>(app.call("config.viewFeedbacks", {}, agent));
assert(defaults.length >= 4, "default view feedbacks available");
assert(
  defaults.some((item) => item.value === "interested" && item.label === "有意向"),
  "default includes interested"
);
assert(
  defaults.some((item) => item.value === "rejected" && item.label === "无意向"),
  "default includes rejected"
);

const house = app.call(
  "house.create",
  {
    title: "带看结果房",
    deal_type: "sale",
    community: "反馈苑",
    price: 210,
    owner_name: "业主",
    owner_phone: "13880001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "带看结果客", phone: "13880002001", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");

const createView = (suffix: string) =>
  app.call(
    "view.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      view_at: new Date().toISOString(),
      content: `带看 ${suffix}`,
    },
    agent
  );

const view1 = createView("1");
assert(view1.ok, "create view 1");
const view1Id = data<any>(view1).id;

assert(
  !app.call("view.complete", { id: view1Id, feedback: "carrier_pigeon" }, agent).ok,
  "reject unknown feedback"
);

const aliasComplete = app.call(
  "view.complete",
  { id: view1Id, feedback: "有意向", content: "客户满意" },
  agent
);
assert(aliasComplete.ok, "chinese alias accepted");
assert(
  data<any>(aliasComplete).feedback === "interested" &&
    data<any>(aliasComplete).feedback_label === "有意向" &&
    data<any>(aliasComplete).deal_shortcut === true,
  "alias normalized with label and deal shortcut"
);

const view2 = createView("2");
assert(view2.ok, "create view 2");
const view2Id = data<any>(view2).id;
assert(
  app.call("view.complete", { id: view2Id, feedback: "rejected", content: "不合适" }, agent).ok,
  "complete rejected"
);

const listed = app.call("view.list", { feedback: "interested" }, agent);
assert(
  listed.ok &&
    data<any[]>(listed).some((row) => row.id === view1Id && row.feedback_label === "有意向") &&
    !data<any[]>(listed).some((row) => row.id === view2Id),
  "list filter by feedback"
);

const byAlias = app.call("view.list", { feedback: "有意向" }, agent);
assert(
  byAlias.ok && data<any[]>(byAlias).some((row) => row.id === view1Id),
  "list filter accepts feedback alias"
);

const activity = app.call("report.activityStats", {}, manager);
assert(activity.ok, "activity stats ok");
const agentRank = (data<any>(activity).rankings || []).find(
  (row: any) => row.user_id === agentId
);
assert(
  agentRank &&
    agentRank.view_count >= 2 &&
    agentRank.effective_view_count === agentRank.view_count - 1,
  "rejected excluded from effective views"
);

assert(
  !app.call(
    "config.dictionary.upsert",
    { dict_type: "view_feedback", value: "hot", label: "强烈意向", sort_order: 1 },
    manager
  ).ok,
  "manager cannot upsert view feedback dictionary"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "view_feedback", value: "hot", label: "强烈意向", sort_order: 1 },
    admin
  ).ok,
  "admin adds custom view feedback"
);

const customList = data<any[]>(app.call("config.viewFeedbacks", {}, agent));
assert(
  customList.some((item) => item.value === "hot" && item.label === "强烈意向"),
  "viewFeedbacks includes custom entry"
);
assert(!customList.some((item) => item.value === "interested"), "custom dictionary replaces defaults");

const view3 = createView("3");
assert(view3.ok, "create view 3");
const view3Id = data<any>(view3).id;
assert(
  !app.call("view.complete", { id: view3Id, feedback: "interested" }, agent).ok,
  "default feedback rejected after custom dictionary overrides"
);

const customComplete = app.call(
  "view.complete",
  { id: view3Id, feedback: "hot", content: "很想买" },
  agent
);
assert(customComplete.ok, "complete with custom feedback");
assert(
  data<any[]>(app.call("view.list", {}, agent)).some(
    (row) => row.id === view3Id && row.feedback === "hot" && row.feedback_label === "强烈意向"
  ),
  "list shows custom feedback label"
);

const pendingView = createView("pending");
assert(pendingView.ok, "create view for pending check");
assert(
  !app.call(
    "view.complete",
    { id: data<any>(pendingView).id, feedback: "pending" },
    agent
  ).ok,
  "pending feedback still rejected"
);

console.log(`View feedbacks smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
