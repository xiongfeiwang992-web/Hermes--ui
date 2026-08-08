import type { Db } from "../db/database";
import type { ApiResult, SessionUser } from "../utils/types";
import * as org from "../domain/org";
import * as house from "../domain/house";
import * as customer from "../domain/customer";
import * as activity from "../domain/activity";
import * as deal from "../domain/deal";
import * as report from "../domain/report";
import * as message from "../domain/message";
import * as property from "../domain/property";
import * as earnest from "../domain/earnest";
import * as transfer from "../domain/transfer";
import * as suite from "../domain/suite";
import * as system from "../domain/system";
import * as attachment from "../domain/attachment";
import * as config from "../domain/config";
import * as contract from "../domain/contract";
import * as dealDocuments from "../domain/dealDocuments";
import * as mortgage from "../domain/mortgage";
import * as entrustment from "../domain/entrustment";
import * as newhome from "../domain/newhome";
import * as offboarding from "../domain/offboarding";
import * as expense from "../domain/expense";
import * as attendance from "../domain/attendance";
import * as cashbook from "../domain/cashbook";
import * as workforce from "../domain/workforce";
import * as recruitment from "../domain/recruitment";
import { listAudit } from "../domain/audit";

const PUBLIC = new Set(["auth.login"]);

export function dispatch(
  db: Db,
  action: string,
  payload: any = {},
  token: string | null = null
): ApiResult {
  try {
    const user = org.getSession(db, token);
    if (!PUBLIC.has(action) && !user) {
      return { ok: false, message: "未登录", code: 401 };
    }
    if (user && !suite.featureAllowed(db, user, action)) {
      return { ok: false, message: "该功能已被管理员禁用", code: 403 };
    }
    return route(db, action, payload, user, token);
  } catch (err: any) {
    return { ok: false, message: err?.message || "服务器错误", code: 500 };
  }
}

function route(
  db: Db,
  action: string,
  payload: any,
  user: SessionUser | null,
  token: string | null
): ApiResult {
  switch (action) {
    case "auth.login":
      return org.login(db, payload.account, payload.password);
    case "auth.logout":
      return org.logout(db, token, user);
    case "auth.me":
      return org.me(user!);
    case "auth.changePassword":
      return org.changePassword(db, user!, payload);

    case "org.stores.list":
      return org.listStores(db, user!);
    case "org.stores.upsert":
      return org.upsertStore(db, user!, payload);
    case "org.users.list":
      return org.listUsers(db, user!);
    case "org.users.store":
      return org.listStoreUsers(db, user!);
    case "org.users.upsert":
      return org.upsertUser(db, user!, payload);

    case "house.list":
      return house.listHouses(db, user!, payload);
    case "house.get":
      return house.getHouse(db, user!, payload.id);
    case "house.create":
      return house.createHouse(db, user!, payload);
    case "house.update":
      return house.updateHouse(db, user!, payload);
    case "house.status":
      return house.changeHouseStatus(db, user!, payload);
    case "house.agent":
      return house.changeHouseAgent(db, user!, payload);
    case "house.lock":
      return house.setHouseLock(db, user!, payload);
    case "house.roles.list":
      return house.listHouseRoles(db, user!, payload);
    case "house.roles.assign":
      return house.assignHouseRole(db, user!, payload);
    case "house.roles.remove":
      return house.removeHouseRole(db, user!, payload);

    case "customer.list":
      return customer.listCustomers(db, user!, payload);
    case "customer.get":
      return customer.getCustomer(db, user!, payload.id);
    case "customer.create":
      return customer.createCustomer(db, user!, payload);
    case "customer.update":
      return customer.updateCustomer(db, user!, payload);
    case "customer.toPublic":
      return customer.toPublic(db, user!, payload);
    case "customer.claim":
      return customer.claimCustomer(db, user!, payload);
    case "customer.matchHouses":
      return customer.matchHouses(db, user!, payload);
    case "customer.contacts.list":
      return customer.listContacts(db, user!, payload);
    case "customer.contacts.upsert":
      return customer.upsertContact(db, user!, payload);
    case "customer.merge":
      return customer.mergeCustomers(db, user!, payload);
    case "customer.publicPool.settings":
      return customer.getPublicPoolSettings(db, user!);
    case "customer.publicPool.update":
      return customer.updatePublicPoolSettings(db, user!, payload);
    case "customer.publicPool.run":
      return customer.runPublicPool(db, user!);

    case "follow.create":
      return activity.createFollow(db, user!, payload);
    case "follow.list":
      return activity.listFollows(db, user!, payload);
    case "view.create":
      return activity.createView(db, user!, payload);
    case "view.list":
      return activity.listViews(db, user!, payload);
    case "view.get":
      return activity.getView(db, user!, payload.id);
    case "view.complete":
      return activity.completeView(db, user!, payload);
    case "view.cancel":
      return activity.cancelView(db, user!, payload);

    case "deal.create":
      return deal.createDeal(db, user!, payload);
    case "deal.list":
      return deal.listDeals(db, user!, payload);
    case "deal.get":
      return deal.getDeal(db, user!, payload.id);
    case "deal.submit":
      return deal.submitDeal(db, user!, payload);
    case "deal.approve":
      return deal.approveDeal(db, user!, payload);
    case "deal.reject":
      return deal.rejectDeal(db, user!, payload);
    case "payment.create":
      return deal.createPayment(db, user!, payload);
    case "payment.list":
      return deal.listPayments(db, user!, payload);
    case "payment.refund":
      return deal.createRefund(db, user!, payload);
    case "commission.list":
      return deal.listCommissions(db, user!);
    case "commission.paid":
      return deal.markCommissionPaid(db, user!, payload);

    case "property.communities.list":
      return property.listCommunities(db, user!, payload);
    case "property.communities.upsert":
      return property.upsertCommunity(db, user!, payload);
    case "property.keys.list":
      return property.listKeys(db, user!, payload);
    case "property.keys.register":
      return property.registerKey(db, user!, payload);
    case "property.keys.borrow":
      return property.borrowKey(db, user!, payload);
    case "property.keys.return":
      return property.returnKey(db, user!, payload);
    case "property.keys.invalidate":
      return property.invalidateKey(db, user!, payload);
    case "property.surveys.list":
      return property.listSurveys(db, user!, payload);
    case "property.surveys.create":
      return property.createSurvey(db, user!, payload);
    case "property.verifications.list":
      return property.listVerifications(db, user!, payload);
    case "property.verifications.submit":
      return property.submitVerification(db, user!, payload);
    case "property.verifications.review":
      return property.reviewVerification(db, user!, payload);

    case "earnest.list":
      return earnest.listEarnest(db, user!, payload);
    case "earnest.create":
      return earnest.createEarnest(db, user!, payload);
    case "earnest.apply":
      return earnest.applyEarnest(db, user!, payload);
    case "earnest.refund":
      return earnest.refundEarnest(db, user!, payload);

    case "transfer.list":
      return transfer.listTransferNodes(db, user!, payload);
    case "transfer.create":
      return transfer.createTransferNode(db, user!, payload);
    case "transfer.status":
      return transfer.changeTransferStatus(db, user!, payload);
    case "transfer.templates.list":
      return transfer.listTransferTemplates(db, user!, payload);
    case "transfer.templates.save":
      return transfer.saveTransferTemplate(db, user!, payload);
    case "transfer.seed":
      return transfer.seedTransferNodes(db, user!, payload);
    case "deal.documents.templates":
      return dealDocuments.listTemplates(db, user!, payload);
    case "deal.documents.template.save":
      return dealDocuments.saveTemplate(db, user!, payload);
    case "deal.documents.init":
      return dealDocuments.initChecklist(db, user!, payload);
    case "deal.documents.list":
      return dealDocuments.listItems(db, user!, payload);
    case "mortgage.get":
      return mortgage.getMortgage(db, user!, payload);
    case "mortgage.upsert":
      return mortgage.upsertMortgage(db, user!, payload);
    case "mortgage.status":
      return mortgage.changeMortgageStatus(db, user!, payload);
    case "entrustment.list":
      return entrustment.listEntrustments(db, user!, payload);
    case "entrustment.register":
      return entrustment.registerEntrustment(db, user!, payload);
    case "entrustment.renew":
      return entrustment.renewEntrustment(db, user!, payload);
    case "entrustment.terminate":
      return entrustment.terminateEntrustment(db, user!, payload);
    case "newhome.projects.list":
      return newhome.listProjects(db, user!, payload);
    case "newhome.projects.save":
      return newhome.upsertProject(db, user!, payload);
    case "newhome.registrations.list":
      return newhome.listRegistrations(db, user!, payload);
    case "newhome.registrations.create":
      return newhome.registerCustomer(db, user!, payload);
    case "newhome.registrations.arrival":
      return newhome.confirmArrival(db, user!, payload);
    case "newhome.registrations.invalidate":
      return newhome.invalidateRegistration(db, user!, payload);
    case "newhome.registrations.expire":
      return newhome.expireRegistrations(db, user!);
    case "offboarding.list":
      return offboarding.listOffboarding(db, user!, payload);
    case "offboarding.preview":
      return offboarding.previewOffboarding(db, user!, payload);
    case "offboarding.start":
      return offboarding.startOffboarding(db, user!, payload);
    case "offboarding.execute":
      return offboarding.executeOffboarding(db, user!, payload);
    case "offboarding.cancel":
      return offboarding.cancelOffboarding(db, user!, payload);
    case "expense.list":
      return expense.listExpenses(db, user!, payload);
    case "expense.create":
      return expense.createExpense(db, user!, payload);
    case "expense.update":
      return expense.updateExpense(db, user!, payload);
    case "expense.submit":
      return expense.submitExpense(db, user!, payload);
    case "expense.review":
      return expense.reviewExpense(db, user!, payload);
    case "expense.pay":
      return expense.payExpense(db, user!, payload);
    case "expense.cancel":
      return expense.cancelExpense(db, user!, payload);
    case "attendance.settings.get":
      return attendance.getAttendanceSettings(db, user!);
    case "attendance.settings.save":
      return attendance.saveAttendanceSettings(db, user!, payload);
    case "attendance.clock":
      return attendance.clockAttendance(db, user!, payload);
    case "attendance.list":
      return attendance.listAttendance(db, user!, payload);
    case "attendance.correct":
      return attendance.correctAttendance(db, user!, payload);
    case "leave.create":
      return attendance.createLeave(db, user!, payload);
    case "leave.list":
      return attendance.listLeaves(db, user!, payload);
    case "leave.review":
      return attendance.reviewLeave(db, user!, payload);
    case "leave.cancel":
      return attendance.cancelLeave(db, user!, payload);
    case "cashbook.list":
      return cashbook.listCashbook(db, user!, payload);
    case "cashbook.options":
      return cashbook.cashbookOptions(db, user!);
    case "cashbook.create":
      return cashbook.createCashbook(db, user!, payload);
    case "cashbook.void":
      return cashbook.voidCashbook(db, user!, payload);
    case "cashbook.summary":
      return cashbook.summarizeCashbook(db, user!, payload);
    case "cashbook.export":
      return cashbook.exportCashbook(db, user!, payload);
    case "workforce.options":
      return workforce.workforceOptions(db, user!);
    case "workforce.grades.list":
      return workforce.listJobGrades(db, user!);
    case "workforce.grades.save":
      return workforce.saveJobGrade(db, user!, payload);
    case "workforce.grades.assign":
      return workforce.assignJobGrade(db, user!, payload);
    case "workforce.transfers.preview":
      return workforce.previewTransfer(db, user!, payload);
    case "workforce.transfers.list":
      return workforce.listTransfers(db, user!, payload);
    case "workforce.transfers.create":
      return workforce.createTransfer(db, user!, payload);
    case "workforce.transfers.review":
      return workforce.reviewTransfer(db, user!, payload);
    case "workforce.transfers.execute":
      return workforce.executeTransfer(db, user!, payload);
    case "workforce.transfers.cancel":
      return workforce.cancelTransfer(db, user!, payload);
    case "recruitment.options":
      return recruitment.recruitmentOptions(db, user!);
    case "recruitment.jobs.list":
      return recruitment.listJobs(db, user!, payload);
    case "recruitment.jobs.save":
      return recruitment.saveJob(db, user!, payload);
    case "recruitment.jobs.close":
      return recruitment.closeJob(db, user!, payload);
    case "recruitment.candidates.list":
      return recruitment.listCandidates(db, user!, payload);
    case "recruitment.candidates.create":
      return recruitment.createCandidate(db, user!, payload);
    case "recruitment.candidates.status":
      return recruitment.changeCandidateStatus(db, user!, payload);
    case "recruitment.candidates.onboard":
      return recruitment.onboardCandidate(db, user!, payload);

    case "report.dashboard":
      return report.dashboard(db, user!);
    case "report.business":
      return report.businessSummary(db, user!, payload);
    case "report.dealsCsv":
      return report.exportDealsCsv(db, user!, payload);
    case "report.housesCsv":
      return report.exportHousesCsv(db, user!, payload);
    case "report.customersCsv":
      return report.exportCustomersCsv(db, user!, payload);
    case "report.followsCsv":
      return report.exportFollowsCsv(db, user!, payload);
    case "report.viewsCsv":
      return report.exportViewsCsv(db, user!, payload);
    case "report.activityStats":
      return report.activityStats(db, user!, payload);

    case "suite.modules":
      return suite.modules();
    case "suite.list":
      return suite.listRecords(db, user!, payload);
    case "suite.create":
      return suite.createRecord(db, user!, payload);
    case "suite.update":
      return suite.updateRecord(db, user!, payload);
    case "suite.status":
      return suite.changeStatus(db, user!, payload);
    case "blacklist.list":
      return suite.listBlacklists(db, user!, payload);
    case "blacklist.add":
      return suite.addBlacklist(db, user!, payload);
    case "permission.list":
      return suite.listPermissions(db, user!);
    case "permission.set":
      return suite.setPermission(db, user!, payload);
    case "integration.list":
      return suite.listIntegrations(db, user!);
    case "integration.configure":
      return suite.configureIntegration(db, user!, payload);
    case "system.backup.create":
      return system.createBackup(db, user!);
    case "system.backup.list":
      return system.listBackups(user!);
    case "attachment.list":
      return attachment.listAttachments(db, user!, payload);
    case "attachment.add":
      return attachment.addAttachment(db, user!, payload);
    case "config.preferences.get":
      return config.getPreferences(db, user!);
    case "config.preferences.save":
      return config.savePreferences(db, user!, payload);
    case "config.dictionary.list":
      return config.listDictionary(db, user!, payload);
    case "config.dictionary.upsert":
      return config.upsertDictionary(db, user!, payload);
    case "config.settings.get":
      return config.getSettings(db, user!);
    case "config.settings.save":
      return config.saveSettings(db, user!, payload);
    case "config.commissionTiers.list":
      return config.listCommissionTiers(db, user!);
    case "config.commissionTiers.save":
      return config.saveCommissionTier(db, user!, payload);
    case "contract.templates":
      return contract.templates(db, user!);
    case "contract.template.save":
      return contract.saveTemplate(db, user!, payload);
    case "contract.sign":
      return contract.sign(db, user!, payload);
    case "contract.signoffs":
      return contract.signoffs(db, user!, payload);
    case "message.list":
      return { ok: true, data: message.listMessages(db, user!) };
    case "message.unread":
      return { ok: true, data: { count: message.unreadCount(db, user!) } };
    case "message.read":
      return { ok: true, data: message.markRead(db, user!, payload.id) };
    case "audit.list":
      return { ok: true, data: listAudit(db, user!, payload) };

    default:
      return { ok: false, message: `未知动作：${action}`, code: 404 };
  }
}
