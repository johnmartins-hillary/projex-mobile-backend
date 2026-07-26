// backend/src/controllers/budgets.controller.js
// Drop-in replacement — keeps all original exports, adds getHealth
const { asyncHandler } = require("../middleware");
const { projectRepo, budgetRepo } = require("../repositories");
const { NotFoundError, AppError } = require("../utils/errors");
const { query } = require("../config/database");

// ── Original methods (unchanged) ─────────────────────────────────────────

exports.getSummary = asyncHandler(async (req, res) => {
  const project = await projectRepo.findById(
    req.params.projectId,
    req.user.companyId,
  );
  if (!project) throw new NotFoundError("Project");
  const summary = await budgetRepo.getSummary(req.params.projectId);
  res.json({
    success: true,
    data: { project: { id: project.id, name: project.name }, ...summary },
  });
});

exports.getAll = asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM budgets WHERE project_id=$1 ORDER BY category",
    [req.query.projectId],
  );
  res.json({ success: true, data: rows });
});

exports.create = asyncHandler(async (req, res) => {
  const project = await projectRepo.findById(
    req.body.projectId,
    req.user.companyId,
  );
  if (!project) throw new NotFoundError("Project");

  if (project.total_budget && Number(project.total_budget) > 0) {
    const { rows: existing } = await query(
      "SELECT COALESCE(SUM(allocated), 0) AS total FROM budgets WHERE project_id=$1",
      [req.body.projectId],
    );
    const currentTotal = parseFloat(existing[0].total);
    const newTotal = currentTotal + Number(req.body.allocated);
    if (newTotal > parseFloat(project.total_budget)) {
      throw new AppError(
        `Budget allocation exceeds project budget. ` +
          `Project budget: ₦${parseFloat(project.total_budget).toLocaleString()}, ` +
          `Already allocated: ₦${currentTotal.toLocaleString()}, ` +
          `New allocation: ₦${Number(req.body.allocated).toLocaleString()}`,
        400,
        "BUDGET_EXCEEDED",
      );
    }
  }

  const b = await budgetRepo.create(req.body);
  res.status(201).json({ success: true, data: b });
});

exports.update = asyncHandler(async (req, res) => {
  const { rows } = await query(
    "UPDATE budgets SET allocated=$1,notes=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
    [req.body.allocated, req.body.notes || null, req.params.id],
  );
  res.json({ success: true, data: rows[0] });
});

// ── NEW: full budget health for the budget tab ────────────────────────────

exports.getHealth = asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const { companyId } = req.user;

  if (projectId) {
    const data = await budgetRepo.getProjectBudget(projectId, companyId);
    if (!data) throw new NotFoundError("Project");
    return res.json({ success: true, data });
  }

  const [summary, projects] = await Promise.all([
    budgetRepo.getCompanySummary(companyId),
    budgetRepo.getAllProjectsBudgetHealth(companyId),
  ]);
  res.json({ success: true, data: { summary, projects } });
});
