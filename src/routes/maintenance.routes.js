const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /maintenance/upcoming  ← must be before /:id
router.get(
  "/upcoming",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT ms.*, e.name AS equipment_name, e.type AS equipment_type
       FROM maintenance_schedules ms
       JOIN equipment e ON e.id = ms.equipment_id
       WHERE ms.company_id=$1 AND ms.status='SCHEDULED'
       AND ms.scheduled_date <= NOW() + INTERVAL '30 days'
       ORDER BY ms.scheduled_date ASC LIMIT 10`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// GET /maintenance
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { equipmentId, status, priority } = req.query;
    const conds = ["ms.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (equipmentId) {
      conds.push(`ms.equipment_id = $${i++}`);
      params.push(equipmentId);
    }
    if (status) {
      conds.push(`ms.status = $${i++}`);
      params.push(status);
    }
    if (priority) {
      conds.push(`ms.priority = $${i++}`);
      params.push(priority);
    }
    const { rows } = await q(
      `SELECT ms.*, e.name AS equipment_name, e.type AS equipment_type, u.first_name, u.last_name
       FROM maintenance_schedules ms
       JOIN equipment e ON e.id = ms.equipment_id
       LEFT JOIN users u ON u.id = ms.created_by_id
       WHERE ${conds.join(" AND ")}
       ORDER BY ms.scheduled_date ASC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /maintenance
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const {
      equipmentId,
      title,
      description,
      maintenanceType,
      scheduledDate,
      cost,
      technicianName,
      technicianPhone,
      priority,
      notes,
      intervalDays,
      photos,
    } = req.body;
    if (!equipmentId || !title || !scheduledDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "equipmentId, title and scheduledDate required",
        });
    }
    const { rows } = await q(
      `INSERT INTO maintenance_schedules
       (company_id, equipment_id, title, description, maintenance_type, scheduled_date,
        cost, technician_name, technician_phone, priority, notes, interval_days, photos, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.user.companyId,
        equipmentId,
        title,
        description || null,
        maintenanceType || "ROUTINE",
        scheduledDate,
        cost || 0,
        technicianName || null,
        technicianPhone || null,
        priority || "MEDIUM",
        notes || null,
        intervalDays || 90,
        JSON.stringify(photos || []),
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PATCH /maintenance/:id/complete  ← must be before /:id
router.patch(
  "/:id/complete",
  protect,
  asyncHandler(async (req, res) => {
    const { completedDate, cost, technicianName, notes, photos } = req.body;
    const { rows: existing } = await q(
      "SELECT * FROM maintenance_schedules WHERE id=$1",
      [req.params.id],
    );
    if (!existing[0]) throw new Error("Not found");
    const nextDate = new Date(completedDate || new Date());
    nextDate.setDate(nextDate.getDate() + (existing[0].interval_days || 90));
    const { rows } = await q(
      `UPDATE maintenance_schedules SET
       status='COMPLETED', completed_date=$1, cost=$2, technician_name=$3,
       notes=$4, photos=$5, next_schedule_date=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [
        completedDate || new Date().toISOString().split("T")[0],
        cost || existing[0].cost,
        technicianName || existing[0].technician_name,
        notes || existing[0].notes,
        JSON.stringify(photos || []),
        nextDate.toISOString().split("T")[0],
        req.params.id,
      ],
    );
    if (existing[0].interval_days) {
      await q(
        `INSERT INTO maintenance_schedules
         (company_id, equipment_id, title, description, maintenance_type,
          scheduled_date, priority, interval_days, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          existing[0].company_id,
          existing[0].equipment_id,
          existing[0].title,
          existing[0].description,
          existing[0].maintenance_type,
          nextDate.toISOString().split("T")[0],
          existing[0].priority,
          existing[0].interval_days,
          req.user.userId,
        ],
      );
    }
    res.json({ success: true, data: rows[0] });
  }),
);

// PATCH /maintenance/:id
router.patch(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      scheduledDate,
      technicianName,
      technicianPhone,
      priority,
      notes,
      status,
    } = req.body;
    const { rows } = await q(
      `UPDATE maintenance_schedules SET
       title=COALESCE($1,title), description=COALESCE($2,description),
       scheduled_date=COALESCE($3,scheduled_date), technician_name=COALESCE($4,technician_name),
       technician_phone=COALESCE($5,technician_phone), priority=COALESCE($6,priority),
       notes=COALESCE($7,notes), status=COALESCE($8,status), updated_at=NOW()
       WHERE id=$9 AND company_id=$10 RETURNING *`,
      [
        title,
        description,
        scheduledDate,
        technicianName,
        technicianPhone,
        priority,
        notes,
        status,
        req.params.id,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /maintenance/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM maintenance_schedules WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
