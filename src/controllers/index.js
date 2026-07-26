const { auth } = require("./auth.controller");
const { dashboard } = require("./dashboard.controller");
const { projects } = require("./projects.controller");
const { materials } = require("./materials.controller");
const { equipment } = require("./equipment.controller");
const { budgets } = require("./budgets.controller");
const { expenses } = require("./expenses.controller");
const { visitors } = require("./visitors.controller");
const { attendance } = require("./attendance.controller");
const { notifications } = require("./notifications.controller");
const { users } = require("./users.controller");
const { sync } = require("./sync.controller");
const { ai } = require("./ai.controller");
const { reports } = require("./reports.controller");
const { employees } = require("./employees.controller");
const { billing } = require("./billing.controller");

module.exports = {
  auth,
  dashboard,
  projects,
  materials,
  equipment,
  budgets,
  expenses,
  visitors,
  attendance,
  notifications,
  users,
  sync,
  ai,
  reports,
  employees,
  billing,
};
