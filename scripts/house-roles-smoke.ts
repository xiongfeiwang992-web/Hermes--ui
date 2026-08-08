import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-roles-smoke.db")).dbPath);
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
const agentA = login("agent_a");
const agentB = login("agent_b");
const crossStoreAgent = login("agent_c");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const crossStoreId = data<any>(app.call("auth.me", {}, crossStoreAgent)).id;

check(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 20,
      manager_award_rate: 0,
      password_min_length: 8,
      deal_required_fields: [],
      deal_doc_required: false,
      house_role_protection_days: 15,
    },
    admin
  ).ok,
  "configure role protection days"
);
const house = app.call(
  "house.create",
  {
    title: "角色保护房源",
    deal_type: "sale",
    community: "角色小区",
    price: 220,
    owner_name: "角色业主",
    owner_phone: "13750000001",
    status: "available",
  },
  agentA
);
check(house.ok, "create role-protected house");
const houseId = data<any>(house).id;
const protectedUntil = new Date(Date.now() + 30 * 86400000).toISOString();
const assigned = app.call(
  "house.roles.assign",
  {
    house_id: houseId,
    role_type: "surveyor",
    user_id: agentAId,
    protected_until: protectedUntil,
  },
  manager
);
check(assigned.ok, "manager assigns protected surveyor");
const listed = app.call("house.roles.list", { house_id: houseId }, agentB);
check(
  listed.ok &&
    data<any[]>(listed).some(
      (role) => role.role_type === "surveyor" && role.user_id === agentAId
    ),
  "store agent can see house role holders"
);
check(
  !app.call(
    "property.surveys.create",
    {
      house_id: houseId,
      survey_type: "survey",
      summary: "非保护角色尝试实勘",
    },
    agentB
  ).ok,
  "protected surveyor blocks other agent"
);
check(
  app.call(
    "property.surveys.create",
    {
      house_id: houseId,
      survey_type: "survey",
      summary: "保护角色完成实勘",
    },
    agentA
  ).ok,
  "protected surveyor can complete survey"
);
check(
  !app.call("house.roles.remove", { id: data<any>(assigned).id }, manager).ok,
  "manager cannot remove active protected role"
);
check(
  !app.call(
    "house.roles.remove",
    { id: data<any>(assigned).id, reason: "" },
    admin
  ).ok,
  "admin override requires reason"
);
check(
  app.call(
    "house.roles.remove",
    { id: data<any>(assigned).id, reason: "人员工作调整" },
    admin
  ).ok,
  "admin removes protected role with reason"
);
check(
  app.call(
    "property.surveys.create",
    {
      house_id: houseId,
      survey_type: "vacant_view",
      summary: "新角色完成空看",
    },
    agentB
  ).ok,
  "survey automatically registers new role holder"
);
const afterSurvey = app.call("house.roles.list", { house_id: houseId }, manager);
check(
  afterSurvey.ok &&
    data<any[]>(afterSurvey).some(
      (role) =>
        role.role_type === "surveyor" &&
        role.user_id === agentBId &&
        Boolean(role.protected_until)
    ),
  "automatic survey role receives configured protection"
);
check(
  app.call(
    "house.roles.assign",
    {
      house_id: houseId,
      role_type: "verifier",
      user_id: agentAId,
      protected_until: protectedUntil,
    },
    manager
  ).ok,
  "assign protected verifier"
);
check(
  !app.call(
    "property.verifications.submit",
    { house_id: houseId, contact_result: "非核验人操作" },
    agentB
  ).ok,
  "protected verifier blocks other agent"
);
check(
  app.call(
    "property.verifications.submit",
    { house_id: houseId, contact_result: "已联系业主确认" },
    agentA
  ).ok,
  "protected verifier can submit verification"
);
check(
  !app.call(
    "house.roles.assign",
    {
      house_id: houseId,
      role_type: "photographer",
      user_id: crossStoreId,
    },
    manager
  ).ok,
  "cannot assign cross-store role holder"
);
check(
  app.call(
    "house.roles.assign",
    {
      house_id: houseId,
      role_type: "photographer",
      user_id: agentBId,
    },
    manager
  ).ok,
  "assign photographer role"
);
const messages = app.call("message.list", {}, agentB);
check(
  messages.ok && data<any[]>(messages).some((message) => message.kind === "house_role"),
  "role assignment sends in-app message"
);

console.log(`House roles smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
