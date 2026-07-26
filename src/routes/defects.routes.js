const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /defects
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, status, priority, category } = req.query;
    const conds = ["d.company_id = $1"];
    const params = [req.user.companyId];
    let idx = 2;
    if (projectId) {
      conds.push(`d.project_id = $${idx++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`d.status = $${idx++}`);
      params.push(status);
    }
    if (priority) {
      conds.push(`d.priority = $${idx++}`);
      params.push(priority);
    }
    if (category) {
      conds.push(`d.category = $${idx++}`);
      params.push(category);
    }
    const { rows } = await q(
      `SELECT d.*, u.first_name, u.last_name, p.name AS project_name
       FROM defects d
       LEFT JOIN users u ON u.id=d.raised_by_id
       LEFT JOIN projects p ON p.id=d.project_id
       WHERE ${conds.join(" AND ")}
       ORDER BY CASE d.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, d.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /defects
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      title,
      description,
      location,
      category,
      priority,
      photos,
      assignedTo,
      dueDate,
    } = req.body;
    if (!projectId || !title)
      return res
        .status(400)
        .json({ success: false, message: "projectId and title required" });
    const { rows } = await q(
      `INSERT INTO defects
       (company_id, project_id, title, description, location, category,
        priority, photos, assigned_to, due_date, raised_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.user.companyId,
        projectId,
        title,
        description || null,
        location || null,
        category || "GENERAL",
        priority || "MEDIUM",
        JSON.stringify(photos || []),
        assignedTo || null,
        dueDate || null,
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PATCH /defects/:id
router.patch(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { status, resolutionNotes, resolutionPhotos, assignedTo, priority } =
      req.body;
    const { rows } = await q(
      `UPDATE defects SET
       status=COALESCE($1,status), resolution_notes=COALESCE($2,resolution_notes),
       resolution_photos=COALESCE($3,resolution_photos), assigned_to=COALESCE($4,assigned_to),
       priority=COALESCE($5,priority),
       resolved_at=CASE WHEN $1='RESOLVED' THEN NOW() ELSE resolved_at END, updated_at=NOW()
       WHERE id=$6 AND company_id=$7 RETURNING *`,
      [
        status || null,
        resolutionNotes || null,
        resolutionPhotos ? JSON.stringify(resolutionPhotos) : null,
        assignedTo || null,
        priority || null,
        req.params.id,
        req.user.companyId,
      ],
    );
    if (!rows[0]) throw new Error("Defect not found");
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /defects/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM defects WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
