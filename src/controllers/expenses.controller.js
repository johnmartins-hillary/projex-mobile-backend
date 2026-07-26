const { asyncHandler } = require("../middleware");
const { projectRepo, expenseRepo } = require("../repositories");
const { NotFoundError, AppError } = require("../utils/errors");
const { notifyBudgetAlert } = require("../services");
const { query } = require("../config/database");

exports.expenses = {
  getAll: asyncHandler(async (req, res) => {
    const expenses = await expenseRepo.findByCompany(
      req.user.companyId,
      req.query,
    );
    res.json({ success: true, data: expenses });
  }),

  create: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.body.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const expense = await expenseRepo.create({
      ...req.body,
      submittedById: req.user.userId,
      photos: req.body.photos || [],
    });
    res.status(201).json({ success: true, data: expense });
  }),

  approve: asyncHandler(async (req, res) => {
    const { rows: existing } = await query(
      "SELECT e.* FROM expenses e JOIN projects p ON p.id=e.project_id WHERE e.id=$1 AND p.company_id=$2",
      [req.params.id, req.user.companyId],
    );
    if (!existing[0]) throw new NotFoundError("Expense");
    if (existing[0].status !== "PENDING")
      throw new AppError("Only pending expenses can be approved", 400);

    if (existing[0].category && existing[0].project_id) {
      const { rows: budgetRows } = await query(
        "SELECT * FROM budgets WHERE project_id=$1 AND category=$2",
        [existing[0].project_id, existing[0].category],
      );
      if (budgetRows[0]) {
        const budget = budgetRows[0];
        const newSpent =
          parseFloat(budget.spent) + parseFloat(existing[0].amount);
        const allocated = parseFloat(budget.allocated);
        if (newSpent > allocated) {
          throw new AppError(
            `Approving this expense will exceed the ${existing[0].category} budget. ` +
              `Budget: ₦${allocated.toLocaleString()}, Already spent: ₦${parseFloat(budget.spent).toLocaleString()}, ` +
              `This expense: ₦${parseFloat(existing[0].amount).toLocaleString()}`,
            400,
            "BUDGET_EXCEEDED",
          );
        }
      }
    }

    const expense = await expenseRepo.approve(req.params.id, req.user.userId);

    if (expense.budget_id) {
      const { rows: budget } = await query(
        "UPDATE budgets SET spent=spent+$1,updated_at=NOW() WHERE id=$2 RETURNING *",
        [expense.amount, expense.budget_id],
      );
      if (budget[0]) {
        const pct =
          parseFloat(budget[0].allocated) > 0
            ? Math.round(
                (parseFloat(budget[0].spent) /
                  parseFloat(budget[0].allocated)) *
                  100,
              )
            : 0;
        if (pct >= 90)
          notifyBudgetAlert(budget[0], pct, req.user.companyId).catch(() => {});
      }
    } else if (expense.category && expense.project_id) {
      const { rows: budget } = await query(
        `UPDATE budgets SET spent=spent+$1, updated_at=NOW()
         WHERE project_id=$2 AND category=$3 RETURNING *`,
        [expense.amount, expense.project_id, expense.category],
      );
      if (budget[0]) {
        const pct =
          parseFloat(budget[0].allocated) > 0
            ? Math.round(
                (parseFloat(budget[0].spent) /
                  parseFloat(budget[0].allocated)) *
                  100,
              )
            : 0;
        if (pct >= 90)
          notifyBudgetAlert(budget[0], pct, req.user.companyId).catch(() => {});
      }
    }

    res.json({ success: true, data: expense });
  }),

  reject: asyncHandler(async (req, res) => {
    const expense = await expenseRepo.reject(
      req.params.id,
      req.body.rejectedReason,
    );
    res.json({ success: true, data: expense });
  }),

  delete: asyncHandler(async (req, res) => {
    await query("DELETE FROM expenses WHERE id=$1 AND status='PENDING'", [
      req.params.id,
    ]);
    res.json({ success: true });
  }),
};
