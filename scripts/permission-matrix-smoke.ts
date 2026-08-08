import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "permission-matrix-smoke.db")).dbPath);
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

check(!app.call("permission.list", {}, manager).ok, "non-admin cannot list permissions");
check(!app.call("permission.list", {}, agent).ok, "agent cannot list permissions");

const listed = app.call("permission.list", {}, admin);
check(listed.ok, "admin lists permission matrix");
const matrixData = data<any>(listed);
check(
  Array.isArray(matrixData.catalog) &&
    matrixData.catalog.length >= 10 &&
    matrixData.catalog.some((item: any) => item.key === "report.*"),
  "catalog includes menu-level report feature"
);
check(
  Array.isArray(matrixData.roles) &&
    matrixData.roles.includes("agent") &&
    matrixData.roles.includes("store_manager") &&
    matrixData.roles.includes("finance") &&
    !matrixData.roles.includes("admin"),
  "matrix roles exclude admin"
);
check(
  Array.isArray(matrixData.matrix) &&
    matrixData.matrix.length === matrixData.catalog.length &&
    matrixData.matrix.every(
      (row: any) =>
        row.roles.agent === true &&
        row.roles.store_manager === true &&
        row.roles.finance === true
    ),
  "default matrix allows all catalog features"
);

check(
  !app.call(
    "permission.set",
    { role: "agent", feature: "not_a_real_feature.*", allowed: false },
    admin
  ).ok,
  "reject unknown feature outside catalog"
);
check(
  !app.call(
    "permission.set",
    { role: "admin", feature: "report.*", allowed: false },
    admin
  ).ok,
  "reject configuring admin role in matrix"
);
check(
  !app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: false },
    manager
  ).ok,
  "non-admin cannot set permissions"
);

check(
  app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: false },
    admin
  ).ok,
  "disable agent report feature via catalog key"
);
const denied = app.call("report.business", {}, agent);
check(!denied.ok && denied.code === 403, "disabled feature blocked at dispatch");
check(app.call("report.business", {}, manager).ok, "other roles unaffected by agent deny");

const afterDeny = data<any>(app.call("permission.list", {}, admin));
const reportRow = afterDeny.matrix.find((row: any) => row.feature === "report.*");
check(reportRow && reportRow.roles.agent === false, "list matrix reflects denied agent report");
check(reportRow && reportRow.roles.store_manager === true, "list matrix keeps manager report allowed");

check(
  app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: true },
    admin
  ).ok,
  "restore agent report feature"
);
check(app.call("report.business", {}, agent).ok, "restored feature accessible again");

const finance = login("finance");
check(app.call("cashbook.list", {}, finance).ok, "finance can list cashbook by default");
check(
  app.call(
    "permission.set",
    { role: "finance", feature: "cashbook.*", allowed: false },
    admin
  ).ok,
  "set finance cashbook feature deny"
);
check(
  !app.call("cashbook.list", {}, finance).ok,
  "finance cashbook blocked when cashbook.* denied"
);
check(
  app.call(
    "permission.set",
    { role: "finance", feature: "cashbook.*", allowed: true },
    admin
  ).ok,
  "restore finance cashbook feature"
);
check(app.call("cashbook.list", {}, finance).ok, "finance cashbook restored");

console.log(`Permission matrix smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
