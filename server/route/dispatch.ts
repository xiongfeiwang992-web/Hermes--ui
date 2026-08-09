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
import * as employeeContract from "../domain/employeeContract";
import * as payroll from "../domain/payroll";
import * as officeContent from "../domain/officeContent";
import * as rental from "../domain/rental";
import * as customerCare from "../domain/customerCare";
import * as marketing from "../domain/marketing";
import * as performance from "../domain/performance";
import * as dealExt from "../domain/dealExt";
import * as propertyExt from "../domain/propertyExt";
import * as financeAssets from "../domain/financeAssets";
import * as officeCollab from "../domain/officeCollab";
import * as mortgageCalc from "../domain/mortgageCalc";
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
    case "house.relatedByOwner":
      return house.listRelatedByOwner(db, user!, payload);
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
    case "contact.reveal":
      return activity.revealContact(db, user!, payload);
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
    case "payment.confirm":
      return deal.confirmPayment(db, user!, payload);
    case "payment.reject":
      return deal.rejectPayment(db, user!, payload);
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
    case "earnest.export":
      return earnest.exportEarnest(db, user!, payload);
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
    case "newhome.options":
      return newhome.newhomeOptions(db, user!);
    case "newhome.distribution.list":
      return newhome.listDistributionCompanies(db, user!, payload);
    case "newhome.distribution.save":
      return newhome.upsertDistributionCompany(db, user!, payload);
    case "newhome.distribution.status":
      return newhome.setDistributionStatus(db, user!, payload);
    case "newhome.distribution.export":
      return newhome.exportDistributionCompanies(db, user!, payload);
    case "newhome.sales.list":
      return newhome.listSalesReports(db, user!, payload);
    case "newhome.sales.create":
      return newhome.createSalesReport(db, user!, payload);
    case "newhome.sales.update":
      return newhome.updateSalesReport(db, user!, payload);
    case "newhome.sales.submit":
      return newhome.submitSalesReport(db, user!, payload);
    case "newhome.sales.approve":
      return newhome.approveSalesReport(db, user!, payload);
    case "newhome.sales.reject":
      return newhome.rejectSalesReport(db, user!, payload);
    case "newhome.sales.settle":
      return newhome.settleSalesReport(db, user!, payload);
    case "newhome.sales.cancel":
      return newhome.cancelSalesReport(db, user!, payload);
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
    case "employee.contracts.options":
      return employeeContract.contractOptions(db, user!);
    case "employee.contracts.list":
      return employeeContract.listContracts(db, user!, payload);
    case "employee.contracts.events":
      return employeeContract.listContractEvents(db, user!, payload);
    case "employee.contracts.create":
      return employeeContract.createContract(db, user!, payload);
    case "employee.contracts.sign":
      return employeeContract.signContract(db, user!, payload);
    case "employee.contracts.activate":
      return employeeContract.activateContract(db, user!, payload);
    case "employee.contracts.renew":
      return employeeContract.renewContract(db, user!, payload);
    case "employee.contracts.terminate":
      return employeeContract.terminateContract(db, user!, payload);
    case "employee.contracts.expire":
      return employeeContract.expireContracts(db, user!);
    case "payroll.options":
      return payroll.payrollOptions(db, user!);
    case "payroll.profiles.list":
      return payroll.listSalaryProfiles(db, user!);
    case "payroll.profiles.save":
      return payroll.saveSalaryProfile(db, user!, payload);
    case "payroll.batches.list":
      return payroll.listPayrollBatches(db, user!);
    case "payroll.batches.create":
      return payroll.createPayrollBatch(db, user!, payload);
    case "payroll.batches.calculate":
      return payroll.calculatePayroll(db, user!, payload);
    case "payroll.items.list":
      return payroll.listPayrollItems(db, user!, payload);
    case "payroll.items.adjust":
      return payroll.adjustPayrollItem(db, user!, payload);
    case "payroll.batches.approve":
      return payroll.approvePayroll(db, user!, payload);
    case "payroll.batches.pay":
      return payroll.payPayroll(db, user!, payload);
    case "payroll.events":
      return payroll.listPayrollEvents(db, user!, payload);
    case "payroll.export":
      return payroll.exportPayroll(db, user!, payload);
    case "officeContent.options":
      return officeContent.officeContentOptions(db, user!);
    case "officeContent.list":
      return officeContent.listDocuments(db, user!, payload);
    case "officeContent.create":
      return officeContent.createDocument(db, user!, payload);
    case "officeContent.update":
      return officeContent.updateDocument(db, user!, payload);
    case "officeContent.publish":
      return officeContent.publishDocument(db, user!, payload);
    case "officeContent.archive":
      return officeContent.archiveDocument(db, user!, payload);
    case "officeContent.read":
      return officeContent.markDocumentRead(db, user!, payload);
    case "officeContent.unread":
      return officeContent.unreadDocuments(db, user!);
    case "officeContent.versions":
      return officeContent.listVersions(db, user!, payload);
    case "rental.options":
      return rental.rentalOptions(db, user!);
    case "rental.properties.list":
      return rental.listProperties(db, user!, payload);
    case "rental.properties.create":
      return rental.createProperty(db, user!, payload);
    case "rental.properties.activate":
      return rental.activateProperty(db, user!, payload);
    case "rental.properties.terminate":
      return rental.terminateProperty(db, user!, payload);
    case "rental.leases.list":
      return rental.listLeases(db, user!, payload);
    case "rental.leases.create":
      return rental.createLease(db, user!, payload);
    case "rental.leases.activate":
      return rental.activateLease(db, user!, payload);
    case "rental.leases.terminate":
      return rental.terminateLease(db, user!, payload);
    case "rental.bills.list":
      return rental.listBills(db, user!, payload);
    case "rental.bills.pay":
      return rental.payBill(db, user!, payload);
    case "rental.bills.void":
      return rental.voidBill(db, user!, payload);
    case "rental.workOrders.list":
      return rental.listWorkOrders(db, user!, payload);
    case "rental.workOrders.create":
      return rental.createWorkOrder(db, user!, payload);
    case "rental.workOrders.status":
      return rental.changeWorkOrderStatus(db, user!, payload);
    case "rental.workOrders.cancel":
      return rental.cancelWorkOrder(db, user!, payload);
    case "rental.events":
      return rental.listEvents(db, user!, payload);
    case "customerCare.options":
      return customerCare.careOptions(db, user!);
    case "customerCare.cases.list":
      return customerCare.listCases(db, user!, payload);
    case "customerCare.cases.create":
      return customerCare.createCase(db, user!, payload);
    case "customerCare.cases.assign":
      return customerCare.assignCase(db, user!, payload);
    case "customerCare.cases.investigate":
      return customerCare.investigateCase(db, user!, payload);
    case "customerCare.cases.resolve":
      return customerCare.resolveCase(db, user!, payload);
    case "customerCare.cases.close":
      return customerCare.closeCase(db, user!, payload);
    case "customerCare.cases.withdraw":
      return customerCare.withdrawCase(db, user!, payload);
    case "customerCare.tasks.list":
      return customerCare.listTasks(db, user!, payload);
    case "customerCare.tasks.create":
      return customerCare.createTask(db, user!, payload);
    case "customerCare.tasks.complete":
      return customerCare.completeTask(db, user!, payload);
    case "customerCare.tasks.cancel":
      return customerCare.cancelTask(db, user!, payload);
    case "customerCare.events":
      return customerCare.listCareEvents(db, user!, payload);
    case "marketing.options":
      return marketing.marketingOptions(db, user!);
    case "marketing.campaigns.list":
      return marketing.listCampaigns(db, user!, payload);
    case "marketing.campaigns.create":
      return marketing.createCampaign(db, user!, payload);
    case "marketing.campaigns.status":
      return marketing.changeCampaignStatus(db, user!, payload);
    case "marketing.leads.list":
      return marketing.listLeads(db, user!, payload);
    case "marketing.leads.create":
      return marketing.createLead(db, user!, payload);
    case "marketing.leads.assign":
      return marketing.assignLead(db, user!, payload);
    case "marketing.leads.status":
      return marketing.changeLeadStatus(db, user!, payload);
    case "marketing.leads.convert":
      return marketing.convertLead(db, user!, payload);
    case "marketing.entrustments.list":
      return marketing.listEntrustments(db, user!, payload);
    case "marketing.entrustments.create":
      return marketing.createEntrustment(db, user!, payload);
    case "marketing.entrustments.accept":
      return marketing.acceptEntrustment(db, user!, payload);
    case "marketing.entrustments.reject":
      return marketing.rejectEntrustment(db, user!, payload);
    case "marketing.events":
      return marketing.listMarketingEvents(db, user!, payload);
    case "performance.options":
      return performance.performanceOptions(db, user!);
    case "performance.rules.list":
      return performance.listPointRules(db, user!);
    case "performance.rules.save":
      return performance.savePointRule(db, user!, payload);
    case "performance.points.list":
      return performance.listPointEntries(db, user!, payload);
    case "performance.points.create":
      return performance.createPointEntry(db, user!, payload);
    case "performance.points.review":
      return performance.reviewPointEntry(db, user!, payload);
    case "performance.targets.list":
      return performance.listTargets(db, user!, payload);
    case "performance.targets.save":
      return performance.saveTarget(db, user!, payload);
    case "performance.bonus.list":
      return performance.listBonusBatches(db, user!, payload);
    case "performance.bonus.create":
      return performance.createBonusBatch(db, user!, payload);
    case "performance.bonus.items":
      return performance.listBonusItems(db, user!, payload);
    case "performance.bonus.pay":
      return performance.payBonusBatch(db, user!, payload);
    case "performance.dividend.list":
      return performance.listDividendBatches(db, user!);
    case "performance.dividend.create":
      return performance.createDividendBatch(db, user!, payload);
    case "performance.dividend.items":
      return performance.listDividendItems(db, user!, payload);
    case "performance.dividend.pay":
      return performance.payDividendBatch(db, user!, payload);
    case "performance.events":
      return performance.listPerformanceEvents(db, user!, payload);
    case "dealExt.options":
      return dealExt.dealExtOptions(db, user!);
    case "dealExt.complaints.list":
      return dealExt.listComplaints(db, user!, payload);
    case "dealExt.complaints.create":
      return dealExt.createComplaint(db, user!, payload);
    case "dealExt.complaints.investigate":
      return dealExt.investigateComplaint(db, user!, payload);
    case "dealExt.complaints.resolve":
      return dealExt.resolveComplaint(db, user!, payload);
    case "dealExt.complaints.reject":
      return dealExt.rejectComplaint(db, user!, payload);
    case "dealExt.complaints.withdraw":
      return dealExt.withdrawComplaint(db, user!, payload);
    case "dealExt.renames.list":
      return dealExt.listRenames(db, user!, payload);
    case "dealExt.renames.create":
      return dealExt.createRename(db, user!, payload);
    case "dealExt.renames.submit":
      return dealExt.submitRename(db, user!, payload);
    case "dealExt.renames.approve":
      return dealExt.approveRename(db, user!, payload);
    case "dealExt.renames.reject":
      return dealExt.rejectRename(db, user!, payload);
    case "dealExt.renames.cancel":
      return dealExt.cancelRename(db, user!, payload);
    case "propertyExt.options":
      return propertyExt.propertyExtOptions(db, user!);
    case "propertyExt.locks.list":
      return propertyExt.listLocks(db, user!, payload);
    case "propertyExt.locks.set":
      return propertyExt.setLock(db, user!, payload);
    case "propertyExt.cooperations.list":
      return propertyExt.listCooperations(db, user!, payload);
    case "propertyExt.cooperations.create":
      return propertyExt.createCooperation(db, user!, payload);
    case "propertyExt.cooperations.end":
      return propertyExt.endCooperation(db, user!, payload);
    case "propertyExt.media.list":
      return propertyExt.listMedia(db, user!, payload);
    case "propertyExt.media.add":
      return propertyExt.addMedia(db, user!, payload);
    case "propertyExt.media.archive":
      return propertyExt.archiveMedia(db, user!, payload);
    case "propertyExt.auction.get":
      return propertyExt.getAuction(db, user!, payload);
    case "propertyExt.auction.save":
      return propertyExt.saveAuction(db, user!, payload);
    case "propertyExt.auction.activate":
      return propertyExt.activateAuction(db, user!, payload);
    case "propertyExt.auction.complete":
      return propertyExt.completeAuction(db, user!, payload);
    case "propertyExt.exclusive.get":
      return propertyExt.getExclusive(db, user!, payload);
    case "propertyExt.exclusive.save":
      return propertyExt.saveExclusive(db, user!, payload);
    case "propertyExt.exclusive.activate":
      return propertyExt.activateExclusive(db, user!, payload);
    case "propertyExt.exclusive.end":
      return propertyExt.endExclusive(db, user!, payload);
    case "finance.options":
      return financeAssets.financeOptions(db, user!);
    case "finance.assets.list":
      return financeAssets.listAssets(db, user!, payload);
    case "finance.assets.save":
      return financeAssets.saveAsset(db, user!, payload);
    case "finance.assets.dispose":
      return financeAssets.disposeAsset(db, user!, payload);
    case "finance.vouchers.list":
      return financeAssets.listVouchers(db, user!, payload);
    case "finance.vouchers.get":
      return financeAssets.getVoucher(db, user!, payload);
    case "finance.vouchers.create":
      return financeAssets.createVoucher(db, user!, payload);
    case "finance.vouchers.update":
      return financeAssets.updateVoucher(db, user!, payload);
    case "finance.vouchers.post":
      return financeAssets.postVoucher(db, user!, payload);
    case "finance.vouchers.void":
      return financeAssets.voidVoucher(db, user!, payload);
    case "officeCollab.options":
      return officeCollab.officeCollabOptions(db, user!);
    case "officeCollab.exams.list":
      return officeCollab.listExams(db, user!, payload);
    case "officeCollab.exams.save":
      return officeCollab.saveExam(db, user!, payload);
    case "officeCollab.exams.publish":
      return officeCollab.publishExam(db, user!, payload);
    case "officeCollab.exams.attempt":
      return officeCollab.submitExamAttempt(db, user!, payload);
    case "officeCollab.events.list":
      return officeCollab.listEvents(db, user!, payload);
    case "officeCollab.events.save":
      return officeCollab.saveEvent(db, user!, payload);
    case "officeCollab.events.open":
      return officeCollab.openEvent(db, user!, payload);
    case "officeCollab.events.signup":
      return officeCollab.signupEvent(db, user!, payload);
    case "officeCollab.workflows.list":
      return officeCollab.listWorkflows(db, user!, payload);
    case "officeCollab.workflows.create":
      return officeCollab.createWorkflow(db, user!, payload);
    case "officeCollab.workflows.submit":
      return officeCollab.submitWorkflow(db, user!, payload);
    case "officeCollab.workflows.decide":
      return officeCollab.decideWorkflow(db, user!, payload);
    case "officeCollab.tickets.list":
      return officeCollab.listTickets(db, user!, payload);
    case "officeCollab.tickets.create":
      return officeCollab.createTicket(db, user!, payload);
    case "officeCollab.tickets.approve":
      return officeCollab.approveTicket(db, user!, payload);
    case "officeCollab.tickets.issue":
      return officeCollab.issueTicket(db, user!, payload);
    case "officeCollab.tickets.return":
      return officeCollab.returnTicket(db, user!, payload);
    case "officeCollab.summaries.list":
      return officeCollab.listSummaries(db, user!, payload);
    case "officeCollab.summaries.save":
      return officeCollab.saveSummary(db, user!, payload);
    case "officeCollab.summaries.submit":
      return officeCollab.submitSummary(db, user!, payload);
    case "officeCollab.summaries.review":
      return officeCollab.reviewSummary(db, user!, payload);
    case "officeCollab.circle.list":
      return officeCollab.listCirclePosts(db, user!, payload);
    case "officeCollab.circle.create":
      return officeCollab.createCirclePost(db, user!, payload);
    case "officeCollab.circle.hide":
      return officeCollab.hideCirclePost(db, user!, payload);
    case "officeCollab.calls.list":
      return officeCollab.listCalls(db, user!, payload);
    case "officeCollab.calls.create":
      return officeCollab.createCall(db, user!, payload);

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
    case "report.dealHotspots":
      return report.dealHotspots(db, user!, payload);
    case "report.houseAttributes":
      return report.houseAttributes(db, user!);
    case "report.customerSources":
      return report.customerSources(db, user!);
    case "report.dealHotspotsCsv":
      return report.exportDealHotspotsCsv(db, user!, payload);
    case "report.houseAttributesCsv":
      return report.exportHouseAttributesCsv(db, user!);
    case "report.customerSourcesCsv":
      return report.exportCustomerSourcesCsv(db, user!);

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
    case "attachment.delete":
      return attachment.deleteAttachment(db, user!, payload);
    case "config.preferences.get":
      return config.getPreferences(db, user!);
    case "config.preferences.save":
      return config.savePreferences(db, user!, payload);
    case "config.dictionary.list":
      return config.listDictionary(db, user!, payload);
    case "config.dictionary.upsert":
      return config.upsertDictionary(db, user!, payload);
    case "config.followMethods":
      return config.listFollowMethods(db, user!);
    case "config.customerSources":
      return config.listCustomerSources(db, user!);
    case "config.paymentMethods":
      return config.listPaymentMethods(db, user!);
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
    case "message.subscriptions.get":
      return message.getSubscriptions(db, user!);
    case "message.subscriptions.save":
      return message.saveSubscriptions(db, user!, payload);
    case "mortgageCalc.compute":
      return mortgageCalc.computeMortgage(db, user!, payload);
    case "audit.list":
      return { ok: true, data: listAudit(db, user!, payload) };

    default:
      return { ok: false, message: `未知动作：${action}`, code: 404 };
  }
}
