import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "expense-categories-smoke.db")).dbPath);
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
const finance = login("finance");
const agent = login("agent_a");

const defaults = data<any[]>(app.call("config.expenseCategories", {}, agent));
assert(defaults.length >= 6, "default expense categories available");
assert(
  defaults.some((item) => item.value === "transport" && item.label === "交通"),
  "default includes transport"
);
assert(
  defaults.some((item) => item.value === "hospitality" && item.label === "业务招待"),
  "default includes hospitality"
);
assert(
  data<any[]>(app.call("config.expenseCategories", {}, finance)).length >= 6,
  "finance can read expense categories"
);
assert(
  !app.call(
    "config.dictionary.upsert",
    { dict_type: "expense_category", value: "training", label: "培训费", sort_order: 10 },
    manager
  ).ok,
  "manager cannot upsert expense category dictionary"
);

assert(
  !app.call(
    "expense.create",
    {
      title: "未知类别",
      category: "carrier_pigeon",
      amount: 20,
      expense_date: "2026-08-08",
    },
    agent
  ).ok,
  "reject unknown category"
);

const alias = app.call(
  "expense.create",
  {
    title: "交通别名报销",
    category: "交通",
    amount: 30,
    expense_date: "2026-08-08",
  },
  agent
);
assert(alias.ok, "chinese alias accepted");
const aliasId = data<any>(alias).id;
assert(
  data<any[]>(app.call("expense.list", {}, agent)).some(
    (row) =>
      row.id === aliasId &&
      row.category === "transport" &&
      row.category_label === "交通"
  ),
  "alias normalized with label"
);

const byCategory = app.call("expense.list", { category: "transport" }, agent);
assert(
  byCategory.ok &&
    data<any[]>(byCategory).every((row) => row.category === "transport") &&
    data<any[]>(byCategory).some((row) => row.id === aliasId),
  "list filter by category"
);
const byAliasFilter = app.call("expense.list", { category: "交通" }, agent);
assert(
  byAliasFilter.ok && data<any[]>(byAliasFilter).some((row) => row.id === aliasId),
  "list filter accepts category alias"
);
const hospitality = app.call(
  "expense.create",
  {
    title: "招待别名",
    category: "业务招待",
    amount: 88,
    expense_date: "2026-08-08",
  },
  agent
);
assert(hospitality.ok, "hospitality alias accepted");
assert(
  data<any[]>(app.call("expense.list", {}, agent)).some(
    (row) =>
      row.id === data<any>(hospitality).id &&
      row.category === "hospitality" &&
      row.category_label === "业务招待"
  ),
  "hospitality alias labeled"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "expense_category", value: "training", label: "培训费", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom expense category"
);

const methods = data<any[]>(app.call("config.expenseCategories", {}, finance));
assert(
  methods.some((item) => item.value === "training" && item.label === "培训费"),
  "expenseCategories includes custom entry"
);
assert(!methods.some((item) => item.value === "transport"), "custom dictionary replaces defaults");

assert(
  !app.call(
    "expense.create",
    {
      title: "默认类别应失败",
      category: "transport",
      amount: 40,
      expense_date: "2026-08-08",
    },
    agent
  ).ok,
  "default category rejected after custom dictionary overrides"
);

const custom = app.call(
  "expense.create",
  {
    title: "培训报销",
    category: "training",
    amount: 500,
    expense_date: "2026-08-08",
    description: "外部培训",
  },
  agent
);
assert(custom.ok, "create with custom expense category");
const customId = data<any>(custom).id;
assert(
  data<any[]>(app.call("expense.list", { category: "training" }, manager)).some(
    (row) => row.id === customId && row.category_label === "培训费"
  ),
  "list shows custom category label"
);

const update = app.call(
  "expense.update",
  {
    id: customId,
    category: "carrier_pigeon",
    title: "培训报销",
    amount: 500,
    expense_date: "2026-08-08",
  },
  agent
);
assert(!update.ok, "update rejects unknown category");

assert(
  app.call(
    "expense.update",
    {
      id: customId,
      category: "training",
      title: "培训报销更新",
      amount: 520,
      expense_date: "2026-08-08",
    },
    agent
  ).ok,
  "update keeps custom category"
);

const audit = app.call("audit.list", { action: "dictionary.upsert", limit: 20 }, admin);
assert(
  audit.ok &&
    (data<any[]>(audit) || []).some((row) => {
      const detail = JSON.parse(row.detail || "{}");
      return row.action === "dictionary.upsert" && detail.dict_type === "expense_category";
    }),
  "dictionary upsert audited"
);

console.log(`Expense categories smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
