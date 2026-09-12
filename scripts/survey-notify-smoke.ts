import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "survey-notify-smoke.db")).dbPath);
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
const surveyMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter((m) => m.kind === "house_survey");

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");

const house1 = app.call(
  "house.create",
  {
    title: "实勘通知盘A",
    deal_type: "sale",
    community: "通知花园",
    district: "测试区",
    price: 200,
    owner_name: "业主甲",
    owner_phone: "13690001001",
    status: "available",
  },
  agentA
);
assert(house1.ok, "agent_a creates house1");
const house1Id = data<any>(house1).id;

const house2 = app.call(
  "house.create",
  {
    title: "实勘自登盘",
    deal_type: "rent",
    community: "通知花园",
    district: "测试区",
    price: 3000,
    owner_name: "业主乙",
    owner_phone: "13690001002",
    status: "available",
  },
  agentA
);
assert(house2.ok, "agent_a creates house2");
const house2Id = data<any>(house2).id;

const beforeA = surveyMsgs(agentA).length;
const beforeB = surveyMsgs(agentB).length;

const survey = app.call(
  "property.surveys.create",
  {
    house_id: house1Id,
    survey_type: "survey",
    summary: "采光良好",
  },
  agentB
);
assert(survey.ok, "agent_b registers survey on agent_a house");
assert(data<any>(survey).survey_type === "survey", "create returns survey_type");

const afterA = surveyMsgs(agentA);
assert(afterA.length === beforeA + 1, "holder receives survey message");
assert(afterA[0].title === "实勘记录已登记", "survey message title");
assert(String(afterA[0].body).includes("实勘通知盘A"), "body has house title");
assert(String(afterA[0].body).includes("经纪人乙"), "body has actor name");
assert(String(afterA[0].body).includes("采光良好"), "body has summary");
assert(surveyMsgs(agentB).length === beforeB, "surveyor does not self-notify as holder");

const beforeSelf = surveyMsgs(agentA).length;
assert(
  app.call(
    "property.surveys.create",
    { house_id: house2Id, survey_type: "survey", summary: "本人实勘" },
    agentA
  ).ok,
  "holder self-registers survey"
);
assert(surveyMsgs(agentA).length === beforeSelf, "self survey skips notify");

const beforeVacant = surveyMsgs(agentA).length;
const vacant = app.call(
  "property.surveys.create",
  {
    house_id: house1Id,
    survey_type: "vacant_view",
    summary: "空看顺利",
  },
  manager
);
assert(vacant.ok, "manager registers vacant_view");
const afterVacant = surveyMsgs(agentA);
assert(afterVacant.length === beforeVacant + 1, "holder receives vacant_view message");
assert(afterVacant[0].title === "空看记录已登记", "vacant_view message title");

const all = data<any[]>(app.call("property.surveys.list", {}, agentA));
assert(all.length >= 3, "list all surveys");
const onlySurvey = data<any[]>(
  app.call("property.surveys.list", { survey_type: "survey" }, agentA)
);
assert(
  onlySurvey.length >= 2 && onlySurvey.every((row) => row.survey_type === "survey"),
  "filter survey_type=survey"
);
const onlyVacant = data<any[]>(
  app.call("property.surveys.list", { survey_type: "vacant_view" }, agentA)
);
assert(
  onlyVacant.length >= 1 && onlyVacant.every((row) => row.survey_type === "vacant_view"),
  "filter survey_type=vacant_view"
);

const house3 = app.call(
  "house.create",
  {
    title: "实勘静音盘",
    deal_type: "sale",
    community: "通知花园",
    district: "测试区",
    price: 180,
    owner_name: "业主丙",
    owner_phone: "13690001003",
    status: "available",
  },
  agentA
);
assert(house3.ok, "create mute-test house");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentA).ok,
  "mute house channel"
);
const beforeMute = surveyMsgs(agentA).length;
assert(
  app.call(
    "property.surveys.create",
    {
      house_id: data<any>(house3).id,
      survey_type: "survey",
      summary: "静音测",
    },
    manager
  ).ok,
  "create survey while muted"
);
assert(surveyMsgs(agentA).length === beforeMute, "muted house channel suppresses survey message");

console.log(`Survey notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
