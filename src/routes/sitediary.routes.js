const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /site-diary
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, startDate, endDate, limit = 30 } = req.query;
    const conds = ["p.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (projectId) {
      conds.push(`sd.project_id = $${i++}`);
      params.push(projectId);
    }
    if (startDate) {
      conds.push(`sd.diary_date >= $${i++}`);
      params.push(startDate);
    }
    if (endDate) {
      conds.push(`sd.diary_date <= $${i++}`);
      params.push(endDate);
    }
    params.push(limit);
    const { rows } = await q(
      `SELECT sd.*, u.first_name, u.last_name, p.name AS project_name
       FROM site_diary sd
       JOIN projects p ON p.id = sd.project_id
       JOIN users u ON u.id = sd.created_by_id
       WHERE ${conds.join(" AND ")}
       ORDER BY sd.diary_date DESC
       LIMIT $${i}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// GET /site-diary/:id
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sd.*, u.first_name, u.last_name, p.name AS project_name
       FROM site_diary sd
       JOIN projects p ON p.id = sd.project_id
       JOIN users u ON u.id = sd.created_by_id
       WHERE sd.id = $1`,
      [req.params.id],
    );
    if (!rows[0])
      throw new (require("../utils/errors").NotFoundError)("Diary entry");
    res.json({ success: true, data: rows[0] });
  }),
);

// POST /site-diary
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      diaryDate,
      weather,
      temperature,
      workersPresent,
      workSummary,
      issues,
      safetyObservations,
      materialsUsed,
      equipmentUsed,
      visitorsCount,
      photos,
      status,
    } = req.body;
    if (!projectId || !workSummary) {
      return res
        .status(400)
        .json({
          success: false,
          message: "projectId and workSummary required",
        });
    }
    const { rows } = await q(
      `INSERT INTO site_diary
       (project_id, created_by_id, diary_date, weather, temperature, workers_present,
        work_summary, issues, safety_observations, materials_used, equipment_used,
        visitors_count, photos, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (project_id, diary_date) DO UPDATE SET
         weather = EXCLUDED.weather, temperature = EXCLUDED.temperature,
         workers_present = EXCLUDED.workers_present, work_summary = EXCLUDED.work_summary,
         issues = EXCLUDED.issues, safety_observations = EXCLUDED.safety_observations,
         materials_used = EXCLUDED.materials_used, equipment_used = EXCLUDED.equipment_used,
         visitors_count = EXCLUDED.visitors_count, photos = EXCLUDED.photos,
         status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [
        projectId,
        req.user.userId,
        diaryDate || new Date().toISOString().split("T")[0],
        weather || "Sunny",
        temperature || null,
        workersPresent || 0,
        workSummary,
        issues || null,
        safetyObservations || null,
        materialsUsed || null,
        equipmentUsed || null,
        visitorsCount || 0,
        JSON.stringify(photos || []),
        status || "DRAFT",
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PUT /site-diary/:id
router.put(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE site_diary SET
       weather=$1, temperature=$2, workers_present=$3, work_summary=$4, issues=$5,
       safety_observations=$6, materials_used=$7, equipment_used=$8, visitors_count=$9,
       photos=$10, status=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [
        req.body.weather,
        req.body.temperature,
        req.body.workersPresent,
        req.body.workSummary,
        req.body.issues,
        req.body.safetyObservations,
        req.body.materialsUsed,
        req.body.equipmentUsed,
        req.body.visitorsCount,
        JSON.stringify(req.body.photos || []),
        req.body.status || "DRAFT",
        req.params.id,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /site-diary/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM site_diary WHERE id=$1", [req.params.id]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
