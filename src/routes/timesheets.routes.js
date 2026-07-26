const express = require("express");
const { protect, authorize, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /timesheets/summary  ← must be before /:id
router.get(
  "/summary",
  protect,
  asyncHandler(async (req, res) => {
    const { weekStart, projectId } = req.query;
    const conds = ["t.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (weekStart) {
      conds.push(`t.week_start = $${i++}`);
      params.push(weekStart);
    }
    if (projectId) {
      conds.push(`t.project_id = $${i++}`);
      params.push(projectId);
    }
    const { rows } = await q(
      `SELECT
       COUNT(*)::int AS total_employees,
       COALESCE(SUM(t.total_hours), 0)::numeric AS total_hours,
       COALESCE(SUM(t.total_pay), 0)::numeric AS total_pay,
       COUNT(*) FILTER (WHERE t.status='APPROVED')::int AS approved_count,
       COUNT(*) FILTER (WHERE t.status='SUBMITTED')::int AS submitted_count,
       COUNT(*) FILTER (WHERE t.status='DRAFT')::int AS draft_count
       FROM timesheets t WHERE ${conds.join(" AND ")}`,
      params,
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// GET /timesheets
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, weekStart, employeeId, status } = req.query;
    const conds = ["t.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (projectId) {
      conds.push(`t.project_id = $${i++}`);
      params.push(projectId);
    }
    if (weekStart) {
      conds.push(`t.week_start = $${i++}`);
      params.push(weekStart);
    }
    if (employeeId) {
      conds.push(`t.employee_id = $${i++}`);
      params.push(employeeId);
    }
    if (status) {
      conds.push(`t.status = $${i++}`);
      params.push(status);
    }
    const { rows } = await q(
      `SELECT t.*, e.first_name, e.last_name, e.role, e.department, p.name AS project_name
       FROM timesheets t
       JOIN employees e ON e.id = t.employee_id
       JOIN projects p ON p.id = t.project_id
       WHERE ${conds.join(" AND ")}
       ORDER BY t.week_start DESC, e.first_name`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /timesheets
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      employeeId,
      weekStart,
      weekEnd,
      monHours,
      tueHours,
      wedHours,
      thuHours,
      friHours,
      satHours,
      sunHours,
      notes,
    } = req.body;
    const { rows: empRows } = await q(
      "SELECT daily_rate FROM employees WHERE id=$1 AND company_id=$2",
      [employeeId, req.user.companyId],
    );
    if (!empRows[0]) throw new Error("Employee not found");
    const { rows } = await q(
      `INSERT INTO timesheets
       (company_id, project_id, employee_id, week_start, week_end,
        mon_hours, tue_hours, wed_hours, thu_hours, fri_hours, sat_hours, sun_hours, daily_rate, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (employee_id, week_start, project_id) DO UPDATE SET
         mon_hours=EXCLUDED.mon_hours, tue_hours=EXCLUDED.tue_hours,
         wed_hours=EXCLUDED.wed_hours, thu_hours=EXCLUDED.thu_hours,
         fri_hours=EXCLUDED.fri_hours, sat_hours=EXCLUDED.sat_hours,
         sun_hours=EXCLUDED.sun_hours, notes=EXCLUDED.notes, updated_at=NOW()
       RETURNING *`,
      [
        req.user.companyId,
        projectId,
        employeeId,
        weekStart,
        weekEnd,
        monHours || 0,
        tueHours || 0,
        wedHours || 0,
        thuHours || 0,
        friHours || 0,
        satHours || 0,
        sunHours || 0,
        empRows[0].daily_rate,
        notes || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PATCH /timesheets/:id/approve  ← before /:id
router.patch(
  "/:id/approve",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE timesheets SET status='APPROVED', approved_by_id=$1, approved_at=NOW(), updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.userId, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// PATCH /timesheets/:id/submit  ← before /:id
router.patch(
  "/:id/submit",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE timesheets SET status='SUBMITTED', updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /timesheets/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM timesheets WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
