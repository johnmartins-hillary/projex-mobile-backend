const UserRepository = require("./user.repository");
const CompanyRepository = require("./company.repository");
const ProjectRepository = require("./project.repository");
const MaterialRepository = require("./material.repository");
const EquipmentRepository = require("./equipment.repository");
const BudgetRepository = require("./budget.repository");
const ExpenseRepository = require("./expense.repository");
const VisitorRepository = require("./visitor.repository");
const AttendanceRepository = require("./attendance.repository");
const NotificationRepository = require("./notification.repository");
const DashboardRepository = require("./dashboard.repository");
const SyncRepository = require("./sync.repository");
const EmployeeRepository = require("./employee.repository");
const BillingRepository = require("./billing.repository");
const DocumentRepository = require("./document.repository");

module.exports = {
  userRepo: new UserRepository(),
  companyRepo: new CompanyRepository(),
  projectRepo: new ProjectRepository(),
  materialRepo: new MaterialRepository(),
  equipmentRepo: new EquipmentRepository(),
  budgetRepo: new BudgetRepository(),
  expenseRepo: new ExpenseRepository(),
  visitorRepo: new VisitorRepository(),
  attendanceRepo: new AttendanceRepository(),
  notificationRepo: new NotificationRepository(),
  dashboardRepo: new DashboardRepository(),
  syncRepo: new SyncRepository(),
  employeeRepo: new EmployeeRepository(),
  billingRepo: new BillingRepository(),
  documentRepo: new DocumentRepository(),
};
