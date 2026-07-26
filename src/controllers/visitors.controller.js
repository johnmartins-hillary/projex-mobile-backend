const { asyncHandler } = require("../middleware");
const { visitorRepo } = require("../repositories");
const { NotFoundError } = require("../utils/errors");
const { query } = require("../config/database");

exports.visitors = {
  getAll: asyncHandler(async (req, res) => {
    const { projectId, date, status, limit = 500 } = req.query;
    const conds = ["p.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (projectId) {
      conds.push(`v.project_id = $${i++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`v.status = $${i++}`);
      params.push(status);
    }
    if (date) {
      conds.push(`DATE(v.time_in AT TIME ZONE 'Africa/Lagos') = $${i++}`);
      params.push(date);
    }
    params.push(Number(limit));
    const { rows } = await query(
      `SELECT v.*, p.name AS project_name
       FROM visitors v
       JOIN projects p ON p.id = v.project_id
       WHERE ${conds.join(" AND ")}
       ORDER BY v.time_in DESC
       LIMIT $${i}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),

  create: asyncHandler(async (req, res) => {
    const v = await visitorRepo.create({
      ...req.body,
      loggedById: req.user.userId,
    });
    res.status(201).json({ success: true, data: v });
  }),

  checkout: asyncHandler(async (req, res) => {
    const v = await visitorRepo.checkout(req.params.id);
    if (!v) throw new NotFoundError("Visitor");
    res.json({ success: true, data: v });
  }),

  delete: asyncHandler(async (req, res) => {
    await query("DELETE FROM visitors WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  }),
};
