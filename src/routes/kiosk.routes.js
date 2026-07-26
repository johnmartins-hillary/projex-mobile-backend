const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// POST /kiosk/checkin  (no auth — PIN-based)
router.post(
  "/checkin",
  asyncHandler(async (req, res) => {
    const { employeeId, projectId, pin, latitude, longitude } = req.body;
    if (!employeeId || !pin || !projectId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "employeeId, projectId and pin required",
        });
    }
    const { rows: empRows } = await q(
      "SELECT * FROM employees WHERE id=$1 AND kiosk_pin=$2 AND kiosk_enabled=TRUE",
      [employeeId, pin],
    );
    if (!empRows[0])
      return res.status(401).json({ success: false, message: "Invalid PIN" });

    if (latitude && longitude) {
      const { rows: projRows } = await q(
        "SELECT site_latitude, site_longitude, site_radius FROM projects WHERE id=$1",
        [projectId],
      );
      const project = projRows[0];
      if (project?.site_latitude && project?.site_longitude) {
        const R = 6371000;
        const lat1 = (parseFloat(project.site_latitude) * Math.PI) / 180;
        const lat2 = (latitude * Math.PI) / 180;
        const dLat =
          ((latitude - parseFloat(project.site_latitude)) * Math.PI) / 180;
        const dLon =
          ((longitude - parseFloat(project.site_longitude)) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const radius = project.site_radius || 500;
        if (distance > radius) {
          return res.status(403).json({
            success: false,
            message: `You are ${Math.round(distance)}m from site. Must be within ${radius}m to check in.`,
            distance: Math.round(distance),
          });
        }
      }
    }

    const { rows: existing } = await q(
      "SELECT * FROM attendances WHERE employee_id=$1 AND DATE(check_in)=CURRENT_DATE",
      [employeeId],
    );
    if (existing[0] && !existing[0].check_out) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Already checked in today",
          data: existing[0],
        });
    }

    const { rows } = await q(
      `INSERT INTO attendances (employee_id, project_id, check_in, latitude, longitude, status)
       VALUES ($1,$2,NOW(),$3,$4,'PRESENT') RETURNING *`,
      [employeeId, projectId, latitude || null, longitude || null],
    );
    await q("UPDATE employees SET last_checkin_at=NOW() WHERE id=$1", [
      employeeId,
    ]);
    res.json({
      success: true,
      message: `Welcome ${empRows[0].first_name}!`,
      data: rows[0],
    });
  }),
);

// GET /kiosk/employees/:projectId  (no auth)
router.get(
  "/employees/:projectId",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT e.id, e.first_name, e.last_name, e.role, e.department,
       e.kiosk_pin IS NOT NULL AS has_pin, e.kiosk_enabled,
       e.last_checkin_at, e.last_checkout_at,
       (SELECT status FROM attendances a WHERE a.employee_id=e.id AND DATE(a.check_in)=CURRENT_DATE LIMIT 1) AS today_status,
       (SELECT id FROM attendances a WHERE a.employee_id=e.id AND DATE(a.check_in)=CURRENT_DATE LIMIT 1) AS today_attendance_id
       FROM employees e
       WHERE e.company_id=(SELECT company_id FROM projects WHERE id=$1)
       AND e.status='ACTIVE' AND e.kiosk_enabled=TRUE
       ORDER BY e.first_name`,
      [req.params.projectId],
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /kiosk/set-pin  (protected)
router.post(
  "/set-pin",
  protect,
  asyncHandler(async (req, res) => {
    const { employeeId, pin } = req.body;
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res
        .status(400)
        .json({ success: false, message: "PIN must be exactly 4 digits" });
    }
    const { rows } = await q(
      "UPDATE employees SET kiosk_pin=$1, kiosk_enabled=TRUE, updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING id, first_name, last_name, kiosk_enabled",
      [pin, employeeId, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Employee not found");
    res.json({ success: true, data: rows[0], message: "PIN set successfully" });
  }),
);

// POST /kiosk/checkout  (no auth — PIN-based)
router.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const { employeeId, pin } = req.body;
    if (!employeeId || !pin) {
      return res
        .status(400)
        .json({ success: false, message: "employeeId and pin required" });
    }
    const { rows: empRows } = await q(
      "SELECT * FROM employees WHERE id=$1 AND kiosk_pin=$2 AND kiosk_enabled=TRUE",
      [employeeId, pin],
    );
    if (!empRows[0])
      return res.status(401).json({ success: false, message: "Invalid PIN" });

    const { rows: attRows } = await q(
      "SELECT * FROM attendances WHERE employee_id=$1 AND DATE(check_in)=CURRENT_DATE AND check_out IS NULL",
      [employeeId],
    );
    if (!attRows[0])
      return res
        .status(400)
        .json({ success: false, message: "No check-in found for today" });

    const hoursWorked = (
      (new Date() - new Date(attRows[0].check_in)) /
      (1000 * 60 * 60)
    ).toFixed(2);
    const { rows } = await q(
      "UPDATE attendances SET check_out=NOW(), hours_worked=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [hoursWorked, attRows[0].id],
    );
    await q("UPDATE employees SET last_checkout_at=NOW() WHERE id=$1", [
      employeeId,
    ]);

    // Auto-update timesheet
    try {
      const dayCol = [
        "sun_hours",
        "mon_hours",
        "tue_hours",
        "wed_hours",
        "thu_hours",
        "fri_hours",
        "sat_hours",
      ][new Date().getDay()];
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(
        today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1),
      );
      const weekStart = monday.toISOString().split("T")[0];
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekEnd = sunday.toISOString().split("T")[0];
      await q(
        `INSERT INTO timesheets
         (company_id, project_id, employee_id, week_start, week_end, ${dayCol}, daily_rate, status)
         VALUES ((SELECT company_id FROM employees WHERE id=$1),$2,$1,$3,$4,$5,(SELECT daily_rate FROM employees WHERE id=$1),'DRAFT')
         ON CONFLICT (employee_id, week_start, project_id)
         DO UPDATE SET ${dayCol}=EXCLUDED.${dayCol}, updated_at=NOW()`,
        [
          employeeId,
          attRows[0].project_id,
          weekStart,
          weekEnd,
          parseFloat(hoursWorked),
        ],
      );
    } catch (e) {
      console.warn("Auto-timesheet update failed:", e.message);
    }

    res.json({
      success: true,
      message: `Goodbye ${empRows[0].first_name}! ${hoursWorked} hours logged.`,
      data: rows[0],
    });
  }),
);

// GET /kiosk/today/:projectId  (no auth)
router.get(
  "/today/:projectId",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT a.*, e.first_name, e.last_name, e.role
       FROM attendances a
       JOIN employees e ON e.id=a.employee_id
       WHERE a.project_id=$1 AND DATE(a.check_in)=CURRENT_DATE
       ORDER BY a.check_in DESC`,
      [req.params.projectId],
    );
    res.json({ success: true, data: rows });
  }),
);

module.exports = router;
