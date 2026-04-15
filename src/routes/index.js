const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate, asyncHandler } = require("../middleware");
const ctrl = require("../controllers");
const { query: q, withTransaction: wt, query } = require("../config/database");
const router = express.Router();

// ── AUTH ──────────────────────────────────────────────────────
router.post(
  "/auth/register",
  [
    body("firstName").trim().notEmpty(),
    body("lastName").trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("companyName").trim().notEmpty(),
    validate,
  ],
  ctrl.auth.register,
);
router.post(
  "/auth/login",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
    validate,
  ],
  ctrl.auth.login,
);
router.post("/auth/refresh", ctrl.auth.refresh);
router.post("/auth/logout", protect, ctrl.auth.logout);
router.post(
  "/auth/forgot-password",
  [body("email").isEmail().normalizeEmail(), validate],
  ctrl.auth.forgotPassword,
);
router.post(
  "/auth/reset-password",
  [body("token").notEmpty(), body("password").isLength({ min: 8 }), validate],
  ctrl.auth.resetPassword,
);
router.get("/auth/me", protect, ctrl.auth.getMe);
router.post(
  "/auth/push-token",
  protect,
  [body("pushToken").notEmpty(), validate],
  ctrl.auth.updatePushToken,
);

// ── DASHBOARD ─────────────────────────────────────────────────
router.get("/dashboard/summary", protect, ctrl.dashboard.getSummary);

// ── PROJECTS ──────────────────────────────────────────────────
router.get("/projects", protect, ctrl.projects.getAll);
router.post(
  "/projects",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  [body("name").trim().notEmpty(), body("type").trim().notEmpty(), validate],
  ctrl.projects.create,
);
router.get(
  "/projects/switcher",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT id, name, type, status, location FROM projects WHERE company_id=$1 AND status='ACTIVE' ORDER BY name",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);
router.get("/projects/:id", protect, ctrl.projects.getOne);
router.put(
  "/projects/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  ctrl.projects.update,
);
router.delete(
  "/projects/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  ctrl.projects.delete,
);

// ── MATERIALS ─────────────────────────────────────────────────
router.get("/materials/low-stock", protect, ctrl.materials.getLowStock);
router.get("/materials", protect, ctrl.materials.getAll);
router.post(
  "/materials",
  protect,
  [
    body("name").trim().notEmpty(),
    body("category").trim().notEmpty(),
    body("unit").trim().notEmpty(),
    validate,
  ],
  ctrl.materials.create,
);
router.get("/materials/:id", protect, ctrl.materials.getOne);
router.put("/materials/:id", protect, ctrl.materials.update);
router.delete("/materials/:id", protect, ctrl.materials.delete);
router.post(
  "/materials/:id/stock-in",
  protect,
  [body("quantity").isNumeric().toFloat(), validate],
  ctrl.materials.stockIn,
);
router.post(
  "/materials/:id/stock-out",
  protect,
  [body("quantity").isNumeric().toFloat(), validate],
  ctrl.materials.stockOut,
);

// ── EQUIPMENT ─────────────────────────────────────────────────
router.get("/equipment", protect, ctrl.equipment.getAll);
router.post(
  "/equipment",
  protect,
  [body("name").trim().notEmpty(), body("type").trim().notEmpty(), validate],
  ctrl.equipment.create,
);
router.get("/equipment/:id", protect, ctrl.equipment.getOne);
router.put("/equipment/:id", protect, ctrl.equipment.update);
router.delete("/equipment/:id", protect, ctrl.equipment.delete);
router.post("/equipment/:id/start-usage", protect, ctrl.equipment.startUsage);
router.post("/equipment/:id/end-usage", protect, ctrl.equipment.endUsage);
router.post(
  "/equipment/:id/maintenance",
  protect,
  [body("description").trim().notEmpty(), validate],
  ctrl.equipment.logMaintenance,
);

// ── BUDGETS ───────────────────────────────────────────────────
router.get("/budgets/summary/:projectId", protect, ctrl.budgets.getSummary);
router.get("/budgets", protect, ctrl.budgets.getAll);
router.post(
  "/budgets",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "QS_ESTIMATOR"),
  [
    body("projectId").notEmpty().withMessage("Project ID is required"),
    body("category").trim().notEmpty(),
    body("allocated").isNumeric(),
    validate,
  ],
  ctrl.budgets.create,
);
router.put(
  "/budgets/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "QS_ESTIMATOR"),
  ctrl.budgets.update,
);

// ── EXPENSES ──────────────────────────────────────────────────
router.get("/expenses", protect, ctrl.expenses.getAll);
router.post(
  "/expenses",
  protect,
  [
    body("projectId").notEmpty().withMessage("Project ID is required"),
    body("category").trim().notEmpty(),
    body("description").trim().notEmpty(),
    body("amount").isNumeric(),
    validate,
  ],
  ctrl.expenses.create,
);
router.patch(
  "/expenses/:id/approve",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"),
  ctrl.expenses.approve,
);
router.patch(
  "/expenses/:id/reject",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"),
  ctrl.expenses.reject,
);
router.delete("/expenses/:id", protect, ctrl.expenses.delete);

// ── VISITORS ──────────────────────────────────────────────────
router.get("/visitors", protect, ctrl.visitors.getAll);
router.post(
  "/visitors",
  protect,
  [
    body("projectId").isUUID(),
    body("fullName").trim().notEmpty(),
    body("purpose").trim().notEmpty(),
    validate,
  ],
  ctrl.visitors.create,
);
router.patch("/visitors/:id/checkout", protect, ctrl.visitors.checkout);
router.delete("/visitors/:id", protect, ctrl.visitors.delete);

// ── ATTENDANCE ────────────────────────────────────────────────
router.post(
  "/attendance/check-in",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.attendance.checkIn,
);
router.patch("/attendance/:id/check-out", protect, ctrl.attendance.checkOut);
router.get("/attendance", protect, ctrl.attendance.getAll);

// ── NOTIFICATIONS ─────────────────────────────────────────────
router.get("/notifications", protect, ctrl.notifications.getAll);
router.patch("/notifications/read-all", protect, ctrl.notifications.readAll);
router.patch("/notifications/:id/read", protect, ctrl.notifications.readOne);

// ── COMPANY BRANDING ──────────────────────────────────────────
router.patch(
  "/company/branding",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  asyncHandler(async (req, res) => {
    const { logoUrl, primaryColor, secondaryColor, tagline, name } = req.body;
    const updated = await q(
      `UPDATE companies SET
      logo_url = COALESCE($1, logo_url),
      primary_color = COALESCE($2, primary_color),
      secondary_color = COALESCE($3, secondary_color),
      tagline = COALESCE($4, tagline),
      name = COALESCE($5, name),
      updated_at = NOW()
     WHERE id = $6 RETURNING *`,
      [
        logoUrl || null,
        primaryColor || null,
        secondaryColor || null,
        tagline || null,
        name || null,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: updated.rows[0] });
  }),
);

// ── USER AVATAR ───────────────────────────────────────────────
router.patch(
  "/users/avatar",
  protect,
  asyncHandler(async (req, res) => {
    const { avatarUrl } = req.body;
    if (!avatarUrl)
      return res
        .status(400)
        .json({ success: false, message: "avatarUrl required" });
    const { rows } = await q(
      "UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [avatarUrl, req.user.userId],
    );
    return res.json({ success: true, debug: req.user });
  }),
);

// ── USERS ─────────────────────────────────────────────────────
router.get(
  "/users",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  ctrl.users.getAll,
);
router.post(
  "/users/invite",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  [body("email").isEmail().normalizeEmail(), body("role").notEmpty(), validate],
  ctrl.users.invite,
);
router.patch("/users/:id", protect, ctrl.users.update);
router.patch(
  "/users/:id/toggle-active",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  ctrl.users.toggleActive,
);

// ── SYNC ──────────────────────────────────────────────────────
router.get("/sync/pull", protect, ctrl.sync.pull);
router.post(
  "/sync/push",
  protect,
  [body("operations").isArray(), validate],
  ctrl.sync.push,
);

// ── AI ────────────────────────────────────────────────────────
router.post(
  "/ai/cost-prediction",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.ai.costPrediction,
);
router.post("/ai/smart-reorder", protect, ctrl.ai.smartReorder);
router.post(
  "/ai/site-summary",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.ai.siteSummary,
);

// ── REPORTS ───────────────────────────────────────────────────
router.get("/reports/materials/pdf", protect, ctrl.reports.materialsPDF);
router.get("/reports/budget/pdf", protect, ctrl.reports.budgetPDF);
router.get("/reports/visitors/pdf", protect, ctrl.reports.visitorsPDF);
router.get("/reports/materials/excel", protect, ctrl.reports.materialsExcel);

// ── SUPPLIERS ─────────────────────────────────────────────────
router.get(
  "/suppliers",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT * FROM suppliers WHERE company_id=$1 AND is_active=TRUE ORDER BY name",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);
router.post(
  "/suppliers",
  protect,
  asyncHandler(async (req, res) => {
    const {
      name,
      contactName,
      phone,
      email,
      address,
      category,
      rating,
      notes,
      bankName,
      accountNumber,
      accountName,
    } = req.body;
    const { rows } = await q(
      `INSERT INTO suppliers (company_id, name, contact_name, phone, email, address, category, rating, notes, bank_name, account_number, account_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.companyId,
        name,
        contactName || null,
        phone || null,
        email || null,
        address || null,
        category || null,
        rating || 0,
        notes || null,
        bankName || null,
        accountNumber || null,
        accountName || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/suppliers/:id",
  protect,
  asyncHandler(async (req, res) => {
    const {
      name,
      contactName,
      phone,
      email,
      address,
      category,
      rating,
      notes,
      bankName,
      accountNumber,
      accountName,
    } = req.body;
    const { rows } = await q(
      `UPDATE suppliers SET 
      name=$1, contact_name=$2, phone=$3, email=$4, address=$5,
      category=$6, rating=$7, notes=$8, bank_name=$9,
      account_number=$10, account_name=$11, updated_at=NOW()
     WHERE id=$12 AND company_id=$13 RETURNING *`,
      [
        name,
        contactName || null,
        phone || null,
        email || null,
        address || null,
        category || null,
        rating || 0,
        notes || null,
        bankName || null,
        accountNumber || null,
        accountName || null,
        req.params.id,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── PURCHASE ORDERS ───────────────────────────────────────────
router.get(
  "/purchase-orders",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT po.*, s.name AS supplier_name, p.name AS project_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id JOIN projects p ON p.id=po.project_id WHERE p.company_id=$1 ORDER BY po.created_at DESC",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);
router.post(
  "/purchase-orders",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, supplierId, items = [], notes, expectedAt } = req.body;
    const poNumber = `PO-${Date.now().toString().slice(-8)}`;
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const po = await wt(async (client) => {
      const { rows } = await client.query(
        "INSERT INTO purchase_orders (project_id,supplier_id,created_by_id,po_number,total_amount,notes,expected_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          projectId,
          supplierId,
          req.user.userId,
          poNumber,
          total,
          notes || null,
          expectedAt || null,
        ],
      );
      for (const item of items)
        await client.query(
          "INSERT INTO po_items (purchase_order_id,description,quantity,unit,unit_price,total_price) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            rows[0].id,
            item.description,
            item.quantity,
            item.unit,
            item.unitPrice,
            item.quantity * item.unitPrice,
          ],
        );
      return rows[0];
    });
    res.status(201).json({ success: true, data: po });
  }),
);
router.patch(
  "/purchase-orders/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE purchase_orders SET status=$1,delivered_at=CASE WHEN $1='DELIVERED' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.body.status, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── SUBCONTRACTS ──────────────────────────────────────────────
router.get(
  "/subcontracts",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT s.* FROM subcontracts s JOIN projects p ON p.id=s.project_id WHERE p.company_id=$1 ORDER BY s.created_at DESC",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);
router.post(
  "/subcontracts",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "INSERT INTO subcontracts (project_id,company_name,contact_name,phone,email,scope,contract_value,start_date,end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [
        req.body.projectId,
        req.body.companyName,
        req.body.contactName || null,
        req.body.phone || null,
        req.body.email || null,
        req.body.scope,
        req.body.contractValue,
        req.body.startDate || null,
        req.body.endDate || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// ── EMPLOYEES ─────────────────────────────────────────────────
router.get("/employees", protect, ctrl.employees.getAll);
router.post(
  "/employees",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  [
    body("firstName").trim().notEmpty(),
    body("lastName").trim().notEmpty(),
    validate,
  ],
  ctrl.employees.create,
);
router.get("/employees/payroll", protect, ctrl.employees.getPayroll);
router.get("/employees/:id", protect, ctrl.employees.getOne);
router.put("/employees/:id", protect, ctrl.employees.update);
router.patch(
  "/employees/:id/status",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  ctrl.employees.setStatus,
);
router.post("/employees/:id/documents", protect, ctrl.employees.addDocument);

// ── BILLING ───────────────────────────────────────────────────
router.get("/billing/subscription", protect, ctrl.billing.getSubscription);
router.post(
  "/billing/initialize",
  protect,
  [body("plan").notEmpty(), body("email").isEmail(), validate],
  ctrl.billing.initialize,
);
router.post(
  "/billing/verify",
  protect,
  [body("reference").notEmpty(), validate],
  ctrl.billing.verify,
);
router.post("/billing/webhook", ctrl.billing.webhook);
router.get("/billing/history", protect, ctrl.billing.getHistory);

// ── FILE UPLOADS ──────────────────────────────────────────────
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.body.folder || "general";
    const dir = path.join(uploadDir, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post("/uploads", protect, upload.single("file"), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  const folder = req.body.folder || "general";
  const url = `${process.env.API_URL || "http://localhost:5000"}/uploads/${folder}/${req.file.filename}`;
  res.json({
    success: true,
    data: {
      url,
      filename: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
    },
  });
});

// ── SITE DIARY ────────────────────────────────────────────────
router.get(
  "/site-diary",
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

router.get(
  "/site-diary/:id",
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

router.post(
  "/site-diary",
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
      return res.status(400).json({
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
     ON CONFLICT (project_id, diary_date) 
     DO UPDATE SET
       weather = EXCLUDED.weather,
       temperature = EXCLUDED.temperature,
       workers_present = EXCLUDED.workers_present,
       work_summary = EXCLUDED.work_summary,
       issues = EXCLUDED.issues,
       safety_observations = EXCLUDED.safety_observations,
       materials_used = EXCLUDED.materials_used,
       equipment_used = EXCLUDED.equipment_used,
       visitors_count = EXCLUDED.visitors_count,
       photos = EXCLUDED.photos,
       status = EXCLUDED.status,
       updated_at = NOW()
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

router.put(
  "/site-diary/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE site_diary SET
       weather = $1, temperature = $2, workers_present = $3,
       work_summary = $4, issues = $5, safety_observations = $6,
       materials_used = $7, equipment_used = $8, visitors_count = $9,
       photos = $10, status = $11, updated_at = NOW()
     WHERE id = $12 RETURNING *`,
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

router.delete(
  "/site-diary/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM site_diary WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Deleted" });
  }),
);

// ── TIMESHEETS ────────────────────────────────────────────────
router.get(
  "/timesheets",
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
      `SELECT t.*, 
      e.first_name, e.last_name, e.role, e.department,
      p.name AS project_name
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

router.post(
  "/timesheets",
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

    // Get employee daily rate
    const { rows: empRows } = await q(
      "SELECT daily_rate FROM employees WHERE id = $1 AND company_id = $2",
      [employeeId, req.user.companyId],
    );
    if (!empRows[0]) throw new Error("Employee not found");
    const dailyRate = empRows[0].daily_rate;

    const { rows } = await q(
      `INSERT INTO timesheets 
     (company_id, project_id, employee_id, week_start, week_end,
      mon_hours, tue_hours, wed_hours, thu_hours, fri_hours, sat_hours, sun_hours,
      daily_rate, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (employee_id, week_start, project_id)
     DO UPDATE SET
       mon_hours = EXCLUDED.mon_hours, tue_hours = EXCLUDED.tue_hours,
       wed_hours = EXCLUDED.wed_hours, thu_hours = EXCLUDED.thu_hours,
       fri_hours = EXCLUDED.fri_hours, sat_hours = EXCLUDED.sat_hours,
       sun_hours = EXCLUDED.sun_hours, notes = EXCLUDED.notes,
       updated_at = NOW()
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
        dailyRate,
        notes || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/timesheets/:id/approve",
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

router.patch(
  "/timesheets/:id/submit",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE timesheets SET status='SUBMITTED', updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/timesheets/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM timesheets WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

router.get(
  "/timesheets/summary",
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
      COUNT(*) FILTER (WHERE t.status = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE t.status = 'SUBMITTED')::int AS submitted_count,
      COUNT(*) FILTER (WHERE t.status = 'DRAFT')::int AS draft_count
     FROM timesheets t
     WHERE ${conds.join(" AND ")}`,
      params,
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── MAINTENANCE SCHEDULES ─────────────────────────────────────
router.get(
  "/maintenance",
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
      `SELECT ms.*, e.name AS equipment_name, e.type AS equipment_type,
      u.first_name, u.last_name
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

router.post(
  "/maintenance",
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
      return res.status(400).json({
        success: false,
        message: "equipmentId, title and scheduledDate required",
      });
    }
    const { rows } = await q(
      `INSERT INTO maintenance_schedules
     (company_id, equipment_id, title, description, maintenance_type,
      scheduled_date, cost, technician_name, technician_phone,
      priority, notes, interval_days, photos, created_by_id)
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

router.patch(
  "/maintenance/:id/complete",
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
      status='COMPLETED', completed_date=$1, cost=$2,
      technician_name=$3, notes=$4, photos=$5,
      next_schedule_date=$6, updated_at=NOW()
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
    // Auto-create next schedule
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

router.patch(
  "/maintenance/:id",
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
      scheduled_date=COALESCE($3,scheduled_date),
      technician_name=COALESCE($4,technician_name),
      technician_phone=COALESCE($5,technician_phone),
      priority=COALESCE($6,priority), notes=COALESCE($7,notes),
      status=COALESCE($8,status), updated_at=NOW()
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

router.delete(
  "/maintenance/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM maintenance_schedules WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

router.get(
  "/maintenance/upcoming",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT ms.*, e.name AS equipment_name, e.type AS equipment_type
     FROM maintenance_schedules ms
     JOIN equipment e ON e.id = ms.equipment_id
     WHERE ms.company_id=$1 AND ms.status='SCHEDULED'
     AND ms.scheduled_date <= NOW() + INTERVAL '30 days'
     ORDER BY ms.scheduled_date ASC
     LIMIT 10`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// ── MATERIAL PRICES ───────────────────────────────────────────

router.get(
  "/material-prices/summary",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT 
      material_name, category, unit,
      MAX(price) AS max_price,
      MIN(price) AS min_price,
      ROUND(AVG(price), 2) AS avg_price,
      COUNT(*)::int AS records,
      MAX(recorded_at) AS last_updated,
      (ARRAY_AGG(price ORDER BY recorded_at DESC))[1] AS latest_price,
      (ARRAY_AGG(price ORDER BY recorded_at DESC))[2] AS previous_price
     FROM material_prices
     WHERE company_id = $1
     GROUP BY material_name, category, unit
     ORDER BY material_name`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

router.get(
  "/material-prices",
  protect,
  asyncHandler(async (req, res) => {
    const { materialName, category, limit = 50 } = req.query;
    const conds = ["mp.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (materialName) {
      conds.push(`mp.material_name ILIKE $${i++}`);
      params.push(`%${materialName}%`);
    }
    if (category) {
      conds.push(`mp.category = $${i++}`);
      params.push(category);
    }
    params.push(Number(limit));
    const { rows } = await q(
      `SELECT mp.*, u.first_name, u.last_name
   FROM material_prices mp
   LEFT JOIN users u ON u.id = mp.recorded_by_id
   WHERE ${conds.join(" AND ")}
   ORDER BY mp.material_name, mp.recorded_at DESC
   LIMIT $${i}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.delete(
  "/material-prices/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM material_prices WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

// ── SUBCONTRACT MILESTONES & PAYMENTS ─────────────────────────
router.get(
  "/subcontracts/:id/milestones",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT m.*, 
      COALESCE(SUM(p.amount), 0)::numeric AS paid_amount
     FROM subcontract_milestones m
     LEFT JOIN subcontract_payments p ON p.milestone_id = m.id
     WHERE m.subcontract_id = $1
     GROUP BY m.id
     ORDER BY m.due_date ASC NULLS LAST, m.created_at ASC`,
      [req.params.id],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/subcontracts/:id/milestones",
  protect,
  asyncHandler(async (req, res) => {
    const { title, description, amount, dueDate, notes } = req.body;
    if (!title || !amount) {
      return res
        .status(400)
        .json({ success: false, message: "title and amount required" });
    }
    const { rows } = await q(
      `INSERT INTO subcontract_milestones
     (subcontract_id, title, description, amount, due_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.params.id,
        title,
        description || null,
        amount,
        dueDate || null,
        notes || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/subcontracts/:id/milestones/:milestoneId",
  protect,
  asyncHandler(async (req, res) => {
    const { status, completedDate, paymentDate, paymentReference, notes } =
      req.body;
    const { rows } = await q(
      `UPDATE subcontract_milestones SET
      status = COALESCE($1, status),
      completed_date = COALESCE($2, completed_date),
      payment_date = COALESCE($3, payment_date),
      payment_reference = COALESCE($4, payment_reference),
      notes = COALESCE($5, notes),
      updated_at = NOW()
     WHERE id = $6 AND subcontract_id = $7 RETURNING *`,
      [
        status,
        completedDate || null,
        paymentDate || null,
        paymentReference || null,
        notes || null,
        req.params.milestoneId,
        req.params.id,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/subcontracts/:id/milestones/:milestoneId",
  protect,
  asyncHandler(async (req, res) => {
    await q(
      "DELETE FROM subcontract_milestones WHERE id=$1 AND subcontract_id=$2",
      [req.params.milestoneId, req.params.id],
    );
    res.json({ success: true, message: "Deleted" });
  }),
);

router.get(
  "/subcontracts/:id/payments",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*, m.title AS milestone_title, u.first_name, u.last_name
     FROM subcontract_payments sp
     LEFT JOIN subcontract_milestones m ON m.id = sp.milestone_id
     LEFT JOIN users u ON u.id = sp.recorded_by_id
     WHERE sp.subcontract_id = $1
     ORDER BY sp.payment_date DESC`,
      [req.params.id],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/subcontracts/:id/payments",
  protect,
  asyncHandler(async (req, res) => {
    const {
      amount,
      paymentDate,
      paymentMethod,
      reference,
      milestoneId,
      notes,
    } = req.body;
    if (!amount)
      return res
        .status(400)
        .json({ success: false, message: "amount required" });

    const payment = await q(
      `INSERT INTO subcontract_payments
     (subcontract_id, milestone_id, amount, payment_date, payment_method, reference, notes, recorded_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id,
        milestoneId || null,
        amount,
        paymentDate || new Date(),
        paymentMethod || "BANK_TRANSFER",
        reference || null,
        notes || null,
        req.user.userId,
      ],
    );

    // Update subcontract amount_paid
    await q(
      `UPDATE subcontracts SET 
      amount_paid = (SELECT COALESCE(SUM(amount), 0) FROM subcontract_payments WHERE subcontract_id = $1),
      updated_at = NOW()
     WHERE id = $1`,
      [req.params.id],
    );

    // Update milestone status if linked
    if (milestoneId) {
      await q(
        `UPDATE subcontract_milestones SET 
        status = 'PAID', payment_date = $1, payment_reference = $2, updated_at = NOW()
       WHERE id = $3`,
        [paymentDate || new Date(), reference || null, milestoneId],
      );
    }

    res.status(201).json({ success: true, data: payment.rows[0] });
  }),
);

router.patch(
  "/subcontracts/:id/release-retention",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE subcontracts SET
      retention_released = TRUE,
      retention_released_at = NOW(),
      amount_paid = amount_paid + retention_amount,
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── SMS ───────────────────────────────────────────────────────
router.post(
  "/sms/send",
  protect,
  asyncHandler(async (req, res) => {
    const { sendSMS, smsTemplates } = require("../services/sms.service");
    const { to, message, template, templateData } = req.body;

    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "Phone number required" });

    let smsMessage = message;
    if (template && smsTemplates[template]) {
      smsMessage = smsTemplates[template](...(templateData || []));
    }

    if (!smsMessage)
      return res
        .status(400)
        .json({ success: false, message: "Message required" });

    const sent = await sendSMS(to, smsMessage);
    res.json({ success: sent, message: sent ? "SMS sent" : "SMS failed" });
  }),
);

router.post(
  "/sms/bulk",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  asyncHandler(async (req, res) => {
    const { sendBulkSMS } = require("../services/sms.service");
    const { recipients, message } = req.body;
    if (!recipients?.length || !message) {
      return res
        .status(400)
        .json({ success: false, message: "recipients and message required" });
    }
    const sent = await sendBulkSMS(recipients, message);
    res.json({ success: true, data: { sent, total: recipients.length } });
  }),
);

// ── CLIENT PORTAL ─────────────────────────────────────────────
const crypto = require("crypto");

router.get(
  "/client-portal",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT cp.*, p.name AS project_name, p.status AS project_status,
      u.first_name, u.last_name
     FROM client_portals cp
     JOIN projects p ON p.id = cp.project_id
     JOIN users u ON u.id = cp.created_by_id
     WHERE cp.company_id = $1
     ORDER BY cp.created_at DESC`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/client-portal",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      clientName,
      clientEmail,
      expiresAt,
      showBudget,
      showExpenses,
      showMaterials,
      showVisitors,
      showPhotos,
    } = req.body;
    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "projectId required" });
    const token = crypto.randomBytes(32).toString("hex");
    const { rows } = await q(
      `INSERT INTO client_portals
     (project_id, company_id, token, client_name, client_email, expires_at,
      show_budget, show_expenses, show_materials, show_visitors, show_photos, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        projectId,
        req.user.companyId,
        token,
        clientName || null,
        clientEmail || null,
        expiresAt || null,
        showBudget !== false,
        showExpenses || false,
        showMaterials !== false,
        showVisitors || false,
        showPhotos !== false,
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/client-portal/:id",
  protect,
  asyncHandler(async (req, res) => {
    const {
      isActive,
      showBudget,
      showExpenses,
      showMaterials,
      showVisitors,
      showPhotos,
      expiresAt,
    } = req.body;
    const { rows } = await q(
      `UPDATE client_portals SET
      is_active = COALESCE($1, is_active),
      show_budget = COALESCE($2, show_budget),
      show_expenses = COALESCE($3, show_expenses),
      show_materials = COALESCE($4, show_materials),
      show_visitors = COALESCE($5, show_visitors),
      show_photos = COALESCE($6, show_photos),
      expires_at = COALESCE($7, expires_at),
      updated_at = NOW()
     WHERE id = $8 AND company_id = $9 RETURNING *`,
      [
        isActive,
        showBudget,
        showExpenses,
        showMaterials,
        showVisitors,
        showPhotos,
        expiresAt || null,
        req.params.id,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/client-portal/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM client_portals WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

// Serve HTML portal page
router.get("/portal/:token", (req, res) => {
  const path = require("path");
  res.sendFile(path.join(__dirname, "../views/clientPortal.html"));
});
// Public endpoint — no auth needed
router.get(
  "/client-portal/view/:token",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT cp.*, p.name AS project_name, p.type, p.status AS project_status,
      p.location, p.start_date, p.end_date, p.description,
      p.client_name, p.client_email, p.total_budget,
      c.name AS company_name, c.logo_url AS company_logo
     FROM client_portals cp
     JOIN projects p ON p.id = cp.project_id
     JOIN companies c ON c.id = cp.company_id
     WHERE cp.token = $1 AND cp.is_active = TRUE`,
      [req.params.token],
    );

    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Portal not found or expired" });

    const portal = rows[0];

    // Check expiry
    if (portal.expires_at && new Date(portal.expires_at) < new Date()) {
      return res
        .status(403)
        .json({ success: false, message: "This portal link has expired" });
    }

    // Update access count
    await q(
      "UPDATE client_portals SET access_count = access_count + 1, last_accessed_at = NOW() WHERE token = $1",
      [req.params.token],
    );

    // Fetch project data based on permissions
    const data = { portal, project: portal };

    if (portal.show_budget) {
      const { rows: budget } = await q(
        `SELECT category, allocated, spent,
        ROUND((spent/NULLIF(allocated,0))*100)::int AS percent_used
       FROM budgets WHERE project_id = $1`,
        [portal.project_id],
      );
      const totalAllocated = budget.reduce(
        (s, b) => s + Number(b.allocated),
        0,
      );
      const totalSpent = budget.reduce((s, b) => s + Number(b.spent), 0);
      data.budget = {
        categories: budget,
        totalAllocated,
        totalSpent,
        percentUsed: totalAllocated
          ? Math.round((totalSpent / totalAllocated) * 100)
          : 0,
      };
    }

    if (portal.show_materials) {
      const { rows: materials } = await q(
        `SELECT name, category, quantity, unit, status
       FROM materials WHERE company_id = (SELECT company_id FROM projects WHERE id = $1)
       ORDER BY status DESC, name LIMIT 20`,
        [portal.project_id],
      );
      data.materials = materials;
    }

    if (portal.show_expenses) {
      const { rows: expenses } = await q(
        `SELECT category, description, amount, status, expense_date
       FROM expenses WHERE project_id = $1 AND status = 'APPROVED'
       ORDER BY expense_date DESC LIMIT 10`,
        [portal.project_id],
      );
      data.expenses = expenses;
    }

    if (portal.show_photos) {
      const { rows: photos } = await q(
        `SELECT pp.title, pp.photo_url, pp.taken_at, pp.category, pp.is_milestone, pp.location
     FROM progress_photos pp
     WHERE pp.project_id = $1
     ORDER BY pp.taken_at DESC
     LIMIT 12`,
        [portal.project_id],
      );
      data.photos = photos;
    }

    res.json({ success: true, data });
  }),
);

// ── PROGRESS PHOTOS ───────────────────────────────────────────
router.get(
  "/progress-photos",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, category, limit = 50 } = req.query;
    const conds = ["pp.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (projectId) {
      conds.push(`pp.project_id = $${i++}`);
      params.push(projectId);
    }
    if (category) {
      conds.push(`pp.category = $${i++}`);
      params.push(category);
    }
    params.push(Number(limit));
    const { rows } = await q(
      `SELECT pp.*, u.first_name, u.last_name, p.name AS project_name
     FROM progress_photos pp
     LEFT JOIN users u ON u.id = pp.taken_by_id
     LEFT JOIN projects p ON p.id = pp.project_id
     WHERE ${conds.join(" AND ")}
     ORDER BY pp.taken_at DESC
     LIMIT $${i}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/progress-photos",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      title,
      description,
      photoUrl,
      location,
      takenAt,
      category,
      isMilestone,
    } = req.body;
    if (!projectId || !photoUrl || !title) {
      return res.status(400).json({
        success: false,
        message: "projectId, title and photoUrl required",
      });
    }
    const { rows } = await q(
      `INSERT INTO progress_photos
     (project_id, company_id, title, description, photo_url,
      location, taken_at, taken_by_id, category, is_milestone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        projectId,
        req.user.companyId,
        title,
        description || null,
        photoUrl,
        location || null,
        takenAt || new Date(),
        req.user.userId,
        category || "GENERAL",
        isMilestone || false,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/progress-photos/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM progress_photos WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

router.get(
  "/progress-photos/timeline",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const conds = ["pp.company_id = $1"];
    const params = [req.user.companyId];
    if (projectId) {
      conds.push("pp.project_id = $2");
      params.push(projectId);
    }
    const { rows } = await q(
      `SELECT 
      TO_CHAR(pp.taken_at, 'YYYY-MM') AS month,
      TO_CHAR(pp.taken_at, 'Month YYYY') AS month_label,
      COUNT(*)::int AS photo_count,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id', pp.id,
          'title', pp.title,
          'photoUrl', pp.photo_url,
          'takenAt', pp.taken_at,
          'category', pp.category,
          'isMilestone', pp.is_milestone,
          'location', pp.location,
          'description', pp.description
        ) ORDER BY pp.taken_at DESC
      ) AS photos
     FROM progress_photos pp
     WHERE ${conds.join(" AND ")}
     GROUP BY TO_CHAR(pp.taken_at, 'YYYY-MM'), TO_CHAR(pp.taken_at, 'Month YYYY')
     ORDER BY month DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// ── KIOSK ─────────────────────────────────────────────────────
router.post(
  "/kiosk/checkin",
  asyncHandler(async (req, res) => {
    const { employeeId, projectId, pin, latitude, longitude } = req.body;
    if (!employeeId || !pin || !projectId) {
      return res.status(400).json({
        success: false,
        message: "employeeId, projectId and pin required",
      });
    }

    // Verify PIN
    const { rows: empRows } = await q(
      "SELECT * FROM employees WHERE id=$1 AND kiosk_pin=$2 AND kiosk_enabled=TRUE",
      [employeeId, pin],
    );
    if (!empRows[0])
      return res.status(401).json({ success: false, message: "Invalid PIN" });

    // GPS validation
    if (latitude && longitude) {
      const { rows: projRows } = await q(
        "SELECT site_latitude, site_longitude, site_radius, name FROM projects WHERE id=$1",
        [projectId],
      );
      const project = projRows[0];
      if (project?.site_latitude && project?.site_longitude) {
        const R = 6371000; // Earth radius in metres
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

    // Check if already checked in today
    const { rows: existing } = await q(
      "SELECT * FROM attendances WHERE employee_id=$1 AND DATE(check_in)=CURRENT_DATE",
      [employeeId],
    );
    if (existing[0] && !existing[0].check_out) {
      return res.status(400).json({
        success: false,
        message: "Already checked in today",
        data: existing[0],
      });
    }

    // Create attendance record
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

router.get(
  "/kiosk/employees/:projectId",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT e.id, e.first_name, e.last_name, e.role, e.department,
      e.kiosk_pin IS NOT NULL AS has_pin,
      e.kiosk_enabled,
      e.last_checkin_at,
      e.last_checkout_at,
      (SELECT status FROM attendances a WHERE a.employee_id = e.id 
       AND DATE(a.check_in) = CURRENT_DATE LIMIT 1) AS today_status,
      (SELECT id FROM attendances a WHERE a.employee_id = e.id 
       AND DATE(a.check_in) = CURRENT_DATE LIMIT 1) AS today_attendance_id
     FROM employees e
     WHERE e.company_id = (SELECT company_id FROM projects WHERE id = $1)
     AND e.status = 'ACTIVE'
     AND e.kiosk_enabled = TRUE
     ORDER BY e.first_name`,
      [req.params.projectId],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/kiosk/set-pin",
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

router.post(
  "/kiosk/checkout",
  asyncHandler(async (req, res) => {
    const { employeeId, pin, attendanceId } = req.body;
    if (!employeeId || !pin) {
      return res
        .status(400)
        .json({ success: false, message: "employeeId and pin required" });
    }
    // Verify PIN
    const { rows: empRows } = await q(
      "SELECT * FROM employees WHERE id=$1 AND kiosk_pin=$2 AND kiosk_enabled=TRUE",
      [employeeId, pin],
    );
    if (!empRows[0])
      return res.status(401).json({ success: false, message: "Invalid PIN" });

    // Find today's attendance
    const { rows: attRows } = await q(
      "SELECT * FROM attendances WHERE employee_id=$1 AND DATE(check_in)=CURRENT_DATE AND check_out IS NULL",
      [employeeId],
    );
    if (!attRows[0])
      return res
        .status(400)
        .json({ success: false, message: "No check-in found for today" });

    // Calculate hours worked
    const checkIn = new Date(attRows[0].check_in);
    const checkOut = new Date();
    const hoursWorked = (
      (checkOut.getTime() - checkIn.getTime()) /
      (1000 * 60 * 60)
    ).toFixed(2);

    const { rows } = await q(
      "UPDATE attendances SET check_out=NOW(), hours_worked=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [hoursWorked, attRows[0].id],
    );

    // Update employee last checkout
    await q("UPDATE employees SET last_checkout_at=NOW() WHERE id=$1", [
      employeeId,
    ]);

    // Auto-create/update timesheet entry
    try {
      const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...
      const dayColumns = [
        "sun_hours",
        "mon_hours",
        "tue_hours",
        "wed_hours",
        "thu_hours",
        "fri_hours",
        "sat_hours",
      ];
      const dayCol = dayColumns[dayOfWeek];

      // Get week start (Monday)
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
     VALUES (
       (SELECT company_id FROM employees WHERE id=$1),
       $2, $1, $3, $4, $5,
       (SELECT daily_rate FROM employees WHERE id=$1),
       'DRAFT'
     )
     ON CONFLICT (employee_id, week_start, project_id)
     DO UPDATE SET ${dayCol} = EXCLUDED.${dayCol}, updated_at=NOW()`,
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

router.get(
  "/kiosk/today/:projectId",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT a.*, e.first_name, e.last_name, e.role
     FROM attendances a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.project_id = $1
     AND DATE(a.check_in) = CURRENT_DATE
     ORDER BY a.check_in DESC`,
      [req.params.projectId],
    );
    res.json({ success: true, data: rows });
  }),
);

// ── INVOICES ──────────────────────────────────────────────────
router.get(
  "/invoices",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, status } = req.query;
    const conds = ["i.company_id = $1"];
    const params = [req.user.companyId];
    let idx = 2;
    if (projectId) {
      conds.push(`i.project_id = $${idx++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`i.status = $${idx++}`);
      params.push(status);
    }
    const { rows } = await q(
      `SELECT i.*, p.name AS project_name,
      (SELECT json_agg(ii.*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
     FROM invoices i
     LEFT JOIN projects p ON p.id = i.project_id
     WHERE ${conds.join(" AND ")}
     ORDER BY i.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/invoices",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      issueDate,
      dueDate,
      taxRate,
      discount,
      notes,
      paymentTerms,
      items,
    } = req.body;
    if (!projectId || !clientName || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "projectId, clientName and items required",
      });
    }

    // Generate invoice number
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM invoices WHERE company_id=$1",
      [req.user.companyId],
    );
    const count = parseInt(countRows[0].count) + 1;
    const invoiceNumber = `INV-${String(count).padStart(4, "0")}`;

    // Calculate totals
    const subtotal = items.reduce(
      (s, it) => s + Number(it.quantity) * Number(it.unitPrice),
      0,
    );
    const taxAmount = subtotal * (Number(taxRate || 7.5) / 100);
    const total = subtotal + taxAmount - Number(discount || 0);

    const { rows } = await q(
      `INSERT INTO invoices
     (company_id, project_id, invoice_number, client_name, client_email,
      client_phone, client_address, issue_date, due_date, status,
      subtotal, tax_rate, tax_amount, discount, total, notes,
      payment_terms, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
      [
        req.user.companyId,
        projectId,
        invoiceNumber,
        clientName,
        clientEmail || null,
        clientPhone || null,
        clientAddress || null,
        issueDate || new Date(),
        dueDate || null,
        subtotal,
        taxRate || 7.5,
        taxAmount,
        discount || 0,
        total,
        notes || null,
        paymentTerms || "Payment due within 30 days",
        req.user.userId,
      ],
    );

    const invoice = rows[0];

    // Insert items
    for (const item of items) {
      await q(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit, unit_price, total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          invoice.id,
          item.description,
          item.quantity,
          item.unit || "item",
          item.unitPrice,
          Number(item.quantity) * Number(item.unitPrice),
        ],
      );
    }

    // Fetch complete invoice with items
    const { rows: full } = await q(
      `SELECT i.*, p.name AS project_name,
      (SELECT json_agg(ii.*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
     FROM invoices i
     LEFT JOIN projects p ON p.id = i.project_id
     WHERE i.id = $1`,
      [invoice.id],
    );

    res.status(201).json({ success: true, data: full[0] });
  }),
);

router.patch(
  "/invoices/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { status, paidAmount } = req.body;
    const validStatuses = ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const isPaid = status === "PAID";
    const { rows } = await q(
      `UPDATE invoices SET
      status = $1,
      paid_at = CASE WHEN $2 THEN NOW() ELSE paid_at END,
      paid_amount = CASE WHEN $2 THEN $3 ELSE paid_amount END,
      updated_at = NOW()
     WHERE id = $4 AND company_id = $5 RETURNING *`,
      [status, isPaid, paidAmount || null, req.params.id, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Invoice not found");
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/invoices/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q(
      "DELETE FROM invoices WHERE id=$1 AND company_id=$2 AND status='DRAFT'",
      [req.params.id, req.user.companyId],
    );
    res.json({ success: true, message: "Deleted" });
  }),
);

// ── DEFECTS & SNAG LIST ───────────────────────────────────────
router.get(
  "/defects",
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
     LEFT JOIN users u ON u.id = d.raised_by_id
     LEFT JOIN projects p ON p.id = d.project_id
     WHERE ${conds.join(" AND ")}
     ORDER BY 
       CASE d.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
       d.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/defects",
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
    if (!projectId || !title) {
      return res
        .status(400)
        .json({ success: false, message: "projectId and title required" });
    }
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

router.patch(
  "/defects/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { status, resolutionNotes, resolutionPhotos, assignedTo, priority } =
      req.body;
    const { rows } = await q(
      `UPDATE defects SET
      status = COALESCE($1, status),
      resolution_notes = COALESCE($2, resolution_notes),
      resolution_photos = COALESCE($3, resolution_photos),
      assigned_to = COALESCE($4, assigned_to),
      priority = COALESCE($5, priority),
      resolved_at = CASE WHEN $1 = 'RESOLVED' THEN NOW() ELSE resolved_at END,
      updated_at = NOW()
     WHERE id = $6 AND company_id = $7 RETURNING *`,
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

router.delete(
  "/defects/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM defects WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

// ── MATERIAL REQUESTS ─────────────────────────────────────────
router.get(
  "/material-requests",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, status } = req.query;
    const conds = ["mr.company_id = $1"];
    const params = [req.user.companyId];
    let idx = 2;
    if (projectId) {
      conds.push(`mr.project_id = $${idx++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`mr.status = $${idx++}`);
      params.push(status);
    }
    const { rows } = await q(
      `SELECT mr.*,
      u.first_name, u.last_name,
      ab.first_name AS approved_first, ab.last_name AS approved_last,
      p.name AS project_name,
      (SELECT json_agg(mri.* ORDER BY mri.created_at) FROM material_request_items mri WHERE mri.request_id = mr.id) AS items
     FROM material_requests mr
     LEFT JOIN users u ON u.id = mr.requested_by_id
     LEFT JOIN users ab ON ab.id = mr.approved_by_id
     LEFT JOIN projects p ON p.id = mr.project_id
     WHERE ${conds.join(" AND ")}
     ORDER BY mr.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/material-requests",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, title, priority, neededBy, notes, items } = req.body;
    if (!projectId || !title || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "projectId, title and items required",
      });
    }

    // Generate request number
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM material_requests WHERE company_id=$1",
      [req.user.companyId],
    );
    const count = parseInt(countRows[0].count) + 1;
    const requestNumber = `MRQ-${String(count).padStart(4, "0")}`;

    const { rows } = await q(
      `INSERT INTO material_requests
     (company_id, project_id, request_number, title, priority, needed_by, notes, requested_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user.companyId,
        projectId,
        requestNumber,
        title,
        priority || "NORMAL",
        neededBy || null,
        notes || null,
        req.user.userId,
      ],
    );

    const request = rows[0];

    // Insert items
    for (const item of items) {
      const total = Number(item.quantity) * Number(item.unitPrice || 0);
      await q(
        `INSERT INTO material_request_items
       (request_id, material_name, quantity, unit, unit_price, total, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          request.id,
          item.materialName,
          item.quantity,
          item.unit || "units",
          item.unitPrice || 0,
          total,
          item.notes || null,
        ],
      );
    }

    // Fetch complete request with items
    const { rows: full } = await q(
      `SELECT mr.*,
      u.first_name, u.last_name, p.name AS project_name,
      (SELECT json_agg(mri.*) FROM material_request_items mri WHERE mri.request_id = mr.id) AS items
     FROM material_requests mr
     LEFT JOIN users u ON u.id = mr.requested_by_id
     LEFT JOIN projects p ON p.id = mr.project_id
     WHERE mr.id = $1`,
      [request.id],
    );

    res.status(201).json({ success: true, data: full[0] });
  }),
);

router.patch(
  "/material-requests/:id/approve",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE material_requests SET
      status = 'APPROVED',
      approved_by_id = $1,
      approved_at = NOW(),
      updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING *`,
      [req.user.userId, req.params.id, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Request not found");

    // Auto-create purchase order if supplier known
    try {
      const { rows: items } = await q(
        "SELECT * FROM material_request_items WHERE request_id = $1",
        [req.params.id],
      );
      const { rows: countRows } = await q(
        "SELECT COUNT(*) FROM purchase_orders WHERE company_id=$1",
        [req.user.companyId],
      );
      const count = parseInt(countRows[0].count) + 1;
      const poNumber = `PO-${String(count).padStart(4, "0")}`;
      const total = items.reduce((s, it) => s + Number(it.total), 0);

      const { rows: poRows } = await q(
        `INSERT INTO purchase_orders
       (company_id, project_id, po_number, total_amount, status, notes)
       VALUES ($1,$2,$3,$4,'DRAFT',$5) RETURNING *`,
        [
          req.user.companyId,
          rows[0].project_id,
          poNumber,
          total,
          `Auto-created from ${rows[0].request_number}`,
        ],
      );

      for (const item of items) {
        await q(
          `INSERT INTO purchase_order_items
         (po_id, description, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            poRows[0].id,
            item.material_name,
            item.quantity,
            item.unit,
            item.unit_price,
            item.total,
          ],
        );
      }

      await q(
        "UPDATE material_requests SET status='ORDERED', updated_at=NOW() WHERE id=$1",
        [req.params.id],
      );
    } catch (e) {
      console.warn("Auto PO creation failed:", e);
    }

    res.json({ success: true, data: rows[0], message: "Request approved" });
  }),
);

router.patch(
  "/material-requests/:id/reject",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const { rows } = await q(
      `UPDATE material_requests SET
      status = 'REJECTED',
      rejection_reason = $1,
      updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING *`,
      [reason || "No reason provided", req.params.id, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Request not found");
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/material-requests/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q(
      "DELETE FROM material_requests WHERE id=$1 AND company_id=$2 AND status='PENDING'",
      [req.params.id, req.user.companyId],
    );
    res.json({ success: true, message: "Deleted" });
  }),
);

// ── WEEKLY REPORT ─────────────────────────────────────────────
router.get(
  "/reports/weekly",
  protect,
  asyncHandler(async (req, res) => {
    const {
      generateWeeklyReport,
      formatWhatsAppReport,
    } = require("../services/weeklyReport.service");
    const data = await generateWeeklyReport(req.user.companyId);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "No active projects found" });
    const message = formatWhatsAppReport(data);
    res.json({ success: true, data: { message, raw: data } });
  }),
);

// ── AI COST ESTIMATOR ─────────────────────────────────────────
router.post(
  "/ai/estimate",
  protect,
  asyncHandler(async (req, res) => {
    const { buildingType, size, location, quality, floors, description } =
      req.body;
    if (!buildingType || !size) {
      return res
        .status(400)
        .json({ success: false, message: "buildingType and size required" });
    }

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are an expert Nigerian quantity surveyor and construction cost estimator with 20+ years experience in Lagos, Abuja, Port Harcourt and other Nigerian cities.

A client wants to estimate the cost of a construction project with these details:
- Building Type: ${buildingType}
- Total Floor Area: ${size} sqm
- Number of Floors: ${floors || 1}
- Location: ${location || "Lagos, Nigeria"}
- Quality Level: ${quality || "Standard"}
- Additional Details: ${description || "None"}

Provide a detailed construction cost estimate in Nigerian Naira (NGN) for ${new Date().getFullYear()}.

Respond ONLY with a valid JSON object in this exact format:
{
  "summary": {
    "totalCost": 150000000,
    "costPerSqm": 750000,
    "buildingType": "3 Bedroom Bungalow",
    "size": 200,
    "location": "Lagos",
    "quality": "Standard",
    "estimatedDuration": "8-12 months",
    "confidence": "Medium"
  },
  "breakdown": [
    {
      "category": "Preliminaries & Site Setup",
      "percentage": 5,
      "amount": 7500000,
      "details": "Site clearing, hoarding, mobilisation, temporary facilities"
    },
    {
      "category": "Substructure (Foundation)",
      "percentage": 15,
      "amount": 22500000,
      "details": "Excavation, concrete foundation, DPC, backfill"
    },
    {
      "category": "Superstructure (Frame)",
      "percentage": 20,
      "amount": 30000000,
      "details": "Columns, beams, slabs, walls, roofing"
    },
    {
      "category": "Roofing",
      "percentage": 8,
      "amount": 12000000,
      "details": "Roof structure, long span sheets, gutters"
    },
    {
      "category": "Finishes",
      "percentage": 20,
      "amount": 30000000,
      "details": "Plastering, tiling, painting, ceilings, doors, windows"
    },
    {
      "category": "Mechanical & Plumbing",
      "percentage": 10,
      "amount": 15000000,
      "details": "Water supply, drainage, sanitary fittings, overhead tank"
    },
    {
      "category": "Electrical",
      "percentage": 10,
      "amount": 15000000,
      "details": "Wiring, conduits, fittings, distribution board, lighting"
    },
    {
      "category": "External Works",
      "percentage": 7,
      "amount": 10500000,
      "details": "Fence, gate, compound paving, landscaping"
    },
    {
      "category": "Contingency (5%)",
      "percentage": 5,
      "amount": 7500000,
      "details": "Unforeseen works and price fluctuations"
    }
  ],
  "assumptions": [
    "Prices based on current Lagos market rates",
    "Standard sand-crete block construction",
    "Long span aluminum roofing sheets",
    "Ceramic floor tiles throughout"
  ],
  "disclaimer": "This is an AI-generated estimate. Actual costs may vary based on site conditions, material price changes, and design specifications. Always obtain professional QS report."
}

Make sure all amounts are realistic for Nigerian construction in ${new Date().getFullYear()}. The percentages must add up to 100. All amounts must add up to totalCost.`;

    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res
        .status(500)
        .json({ success: false, message: "Could not parse AI response" });
    }

    const estimate = JSON.parse(jsonMatch[0]);
    res.json({ success: true, data: estimate });
  }),
);

// ── MARKETPLACE — PUBLIC ───────────────────────────────────────
// Browse suppliers (no auth needed for browsing)
router.get(
  "/marketplace/suppliers",
  asyncHandler(async (req, res) => {
    const {
      category,
      city,
      state,
      search,
      lat,
      lng,
      radius = 50,
      limit = 20,
      offset = 0,
    } = req.query;

    const conds = ["sp.is_active = TRUE"];
    const params = [];
    let i = 1;

    if (search) {
      conds.push(
        `(sp.business_name ILIKE $${i} OR sp.description ILIKE $${i} OR $${i} = ANY(sp.categories))`,
      );
      params.push(`%${search}%`);
      i++;
    }
    if (city) {
      conds.push(`sp.city ILIKE $${i++}`);
      params.push(`%${city}%`);
    }
    if (state) {
      conds.push(`sp.state ILIKE $${i++}`);
      params.push(`%${state}%`);
    }
    if (category) {
      conds.push(`$${i++} = ANY(sp.categories)`);
      params.push(category);
    }

    let distanceSelect = "NULL::numeric AS distance_km";
    if (lat && lng) {
      distanceSelect = `ROUND((6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude)))))::numeric, 1) AS distance_km`;
      conds.push(`sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL`);
      conds.push(
        `(6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude))))) <= $${i + 2}`,
      );
      params.push(parseFloat(lat), parseFloat(lng), parseFloat(radius));
      i += 3;
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await q(
      `SELECT sp.*, ${distanceSelect},
        (SELECT COUNT(*) FROM supplier_products WHERE supplier_id = sp.id AND is_available = TRUE) AS product_count,
        (SELECT json_agg(p.*) FROM supplier_products p WHERE p.supplier_id = sp.id AND p.is_available = TRUE LIMIT 4) AS featured_products,
        EXISTS (
          SELECT 1 FROM featured_placements fp
          WHERE fp.supplier_id = sp.id
          AND fp.type = 'STORE'
          AND fp.is_active = TRUE
          AND fp.ends_at > NOW()
        ) AS is_featured_store
       FROM supplier_profiles sp
       WHERE ${conds.join(" AND ")}
       ORDER BY
         is_featured_store DESC,
         ${lat && lng ? "distance_km ASC," : ""}
         sp.is_verified DESC,
         sp.rating DESC,
         sp.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params,
    );

    const { rows: countRows } = await q(
      `SELECT COUNT(*) FROM supplier_profiles sp WHERE ${conds.join(" AND ")}`,
      params.slice(0, params.length - 2),
    );

    res.json({
      success: true,
      data: rows,
      total: parseInt(countRows[0].count),
    });
  }),
);

// Get single supplier
router.get(
  "/marketplace/suppliers/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*,
      (SELECT json_agg(p.* ORDER BY p.created_at DESC) 
       FROM supplier_products p 
       WHERE p.supplier_id = sp.id AND p.is_available = TRUE) AS products,
      (SELECT json_agg(r.*) 
       FROM (SELECT * FROM supplier_reviews 
             WHERE supplier_id = sp.id 
             ORDER BY created_at DESC 
             LIMIT 10) r) AS reviews
     FROM supplier_profiles sp
     WHERE sp.id = $1 AND sp.is_active = TRUE`,
      [req.params.id],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found" });
    res.json({ success: true, data: rows[0] });
  }),
);

// Search products across all suppliers
router.get(
  "/marketplace/products",
  asyncHandler(async (req, res) => {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      lat,
      lng,
      limit = 30,
      offset = 0,
    } = req.query;

    const conds = ["p.is_available = TRUE", "sp.is_active = TRUE"];
    const params = [];
    let i = 1;

    if (search) {
      conds.push(
        `(p.name ILIKE $${i} OR p.description ILIKE $${i} OR p.category ILIKE $${i})`,
      );
      params.push(`%${search}%`);
      i++;
    }
    if (category) {
      conds.push(`p.category ILIKE $${i++}`);
      params.push(`%${category}%`);
    }
    if (minPrice) {
      conds.push(`p.price >= $${i++}`);
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      conds.push(`p.price <= $${i++}`);
      params.push(parseFloat(maxPrice));
    }

    let distanceSelect = "NULL::numeric AS supplier_distance_km";
    if (lat && lng) {
      distanceSelect = `ROUND((6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude)))))::numeric, 1) AS supplier_distance_km`;
      params.push(parseFloat(lat), parseFloat(lng));
      i += 2;
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await q(
      `SELECT p.*, ${distanceSelect},
        sp.business_name AS supplier_name, sp.city, sp.state,
        sp.rating AS supplier_rating, sp.is_verified,
        sp.whatsapp AS supplier_whatsapp, sp.delivery_radius_km,
        EXISTS (
          SELECT 1 FROM featured_placements fp
          WHERE fp.product_id = p.id
          AND fp.type = 'PRODUCT'
          AND fp.is_active = TRUE
          AND fp.ends_at > NOW()
        ) AS is_featured_product,
        EXISTS (
          SELECT 1 FROM featured_placements fp2
          WHERE fp2.supplier_id = p.supplier_id
          AND fp2.type = 'STORE'
          AND fp2.is_active = TRUE
          AND fp2.ends_at > NOW()
        ) AS supplier_is_featured
       FROM supplier_products p
       JOIN supplier_profiles sp ON sp.id = p.supplier_id
       WHERE ${conds.join(" AND ")}
       ORDER BY
         is_featured_product DESC,
         supplier_is_featured DESC,
         ${lat && lng ? "supplier_distance_km ASC," : ""}
         sp.is_verified DESC,
         sp.rating DESC,
         p.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params,
    );

    res.json({ success: true, data: rows });
  }),
);

// Get product categories
router.get(
  "/marketplace/categories",
  asyncHandler(async (req, res) => {
    const categories = [
      { id: "cement", label: "Cement", icon: "🏭" },
      { id: "sand", label: "Sand & Gravel", icon: "⛏️" },
      { id: "iron_rods", label: "Iron Rods & Steel", icon: "🔩" },
      { id: "blocks", label: "Blocks & Bricks", icon: "🧱" },
      { id: "roofing", label: "Roofing Materials", icon: "🏠" },
      { id: "tiles", label: "Tiles & Finishing", icon: "🪟" },
      { id: "plumbing", label: "Plumbing", icon: "🚿" },
      { id: "electrical", label: "Electrical", icon: "⚡" },
      { id: "timber", label: "Timber & Wood", icon: "🪵" },
      { id: "paint", label: "Paint & Chemicals", icon: "🎨" },
      { id: "tools", label: "Tools & Equipment", icon: "🔧" },
      { id: "other", label: "Other Materials", icon: "📦" },
    ];
    res.json({ success: true, data: categories });
  }),
);

// ── SUPPLIER MANAGEMENT (auth required) ───────────────────────
// Register as supplier
router.post(
  "/marketplace/supplier/register",
  protect,
  asyncHandler(async (req, res) => {
    const existing = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (existing.rows[0])
      return res
        .status(400)
        .json({ success: false, message: "Already registered as supplier" });

    const {
      businessName,
      cacNumber,
      description,
      address,
      city,
      state,
      latitude,
      longitude,
      deliveryRadiusKm,
      whatsapp,
      phone,
      email,
      categories,
    } = req.body;

    if (!businessName || !city || !state) {
      return res.status(400).json({
        success: false,
        message: "businessName, city and state required",
      });
    }

    const { rows } = await q(
      `INSERT INTO supplier_profiles
     (user_id, business_name, cac_number, description, address, city, state,
      latitude, longitude, delivery_radius_km, whatsapp, phone, email, categories)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.user.userId,
        businessName,
        cacNumber || null,
        description || null,
        address || null,
        city,
        state,
        latitude || null,
        longitude || null,
        deliveryRadiusKm || 50,
        whatsapp || null,
        phone || null,
        email || null,
        categories || [],
      ],
    );

    // Update user role to SUPPLIER
    await q("UPDATE users SET role='SUPPLIER', updated_at=NOW() WHERE id=$1", [
      req.user.userId,
    ]);

    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// Get my supplier profile
router.get(
  "/marketplace/supplier/me",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*,
      (SELECT json_agg(p.* ORDER BY p.created_at DESC) FROM supplier_products p WHERE p.supplier_id = sp.id) AS products
     FROM supplier_profiles sp WHERE sp.user_id = $1`,
      [req.user.userId],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    res.json({ success: true, data: rows[0] });
  }),
);

// Update supplier profile
router.patch(
  "/marketplace/supplier/me",
  protect,
  asyncHandler(async (req, res) => {
    const {
      businessName,
      description,
      address,
      city,
      state,
      latitude,
      longitude,
      deliveryRadiusKm,
      whatsapp,
      phone,
      categories,
      logoUrl,
      bannerUrl,
      bankName,
      bankCode,
      accountNumber,
      accountName,
    } = req.body;

    // Check supplier exists first
    const { rows: existing } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!existing[0]) {
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    }

    // Create Paystack recipient if bank details provided
    let recipientCode = null;
    if (
      accountNumber &&
      bankCode &&
      accountName &&
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "nuban",
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: "NGN",
          }),
        });
        const data = await r.json();
        if (data.status) recipientCode = data.data?.recipient_code;
      } catch (e) {
        logger.warn("Failed to create Paystack recipient:", e.message);
      }
    }

    const { rows } = await q(
      `UPDATE supplier_profiles SET
      business_name = COALESCE($1, business_name),
      description = COALESCE($2, description),
      address = COALESCE($3, address),
      city = COALESCE($4, city),
      state = COALESCE($5, state),
      latitude = COALESCE($6, latitude),
      longitude = COALESCE($7, longitude),
      delivery_radius_km = COALESCE($8, delivery_radius_km),
      whatsapp = COALESCE($9, whatsapp),
      phone = COALESCE($10, phone),
      categories = COALESCE($11, categories),
      logo_url = COALESCE($12, logo_url),
      banner_url = COALESCE($13, banner_url),
      bank_name = COALESCE($14, bank_name),
      bank_code = COALESCE($15, bank_code),
      account_number = COALESCE($16, account_number),
      account_name = COALESCE($17, account_name),
      paystack_recipient_code = COALESCE($18, paystack_recipient_code),
      updated_at = NOW()
     WHERE user_id = $19 RETURNING *`,
      [
        businessName,
        description,
        address,
        city,
        state,
        latitude,
        longitude,
        deliveryRadiusKm,
        whatsapp,
        phone,
        categories,
        logoUrl,
        bannerUrl,
        bankName,
        bankCode,
        accountNumber,
        accountName,
        recipientCode,
        req.user.userId,
      ],
    );

    res.json({ success: true, data: rows[0] });
  }),
);

// ── SUPPLIER PRODUCTS ─────────────────────────────────────────
router.get(
  "/marketplace/supplier/products",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });

    const { rows } = await q(
      "SELECT * FROM supplier_products WHERE supplier_id=$1 ORDER BY created_at DESC",
      [supplier[0].id],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/marketplace/supplier/products",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Register as supplier first" });

    const {
      name,
      description,
      category,
      unit,
      price,
      minOrder,
      maxOrder,
      availableQuantity,
      images,
    } = req.body;
    if (!name || !category || !unit || !price) {
      return res.status(400).json({
        success: false,
        message: "name, category, unit and price required",
      });
    }

    // Fix images array
    const imagesValue = images?.length
      ? `{${images.map((i) => `"${i}"`).join(",")}}`
      : "{}";

    const { rows } = await q(
      `INSERT INTO supplier_products
     (supplier_id, name, description, category, unit, price, min_order, max_order, available_quantity, images)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        supplier[0].id,
        name,
        description || null,
        category,
        unit,
        price,
        minOrder || 1,
        maxOrder || null,
        availableQuantity || null,
        imagesValue,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/marketplace/supplier/products/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });

    const {
      name,
      description,
      category,
      unit,
      price,
      minOrder,
      availableQuantity,
      images,
      isAvailable,
    } = req.body;

    // Fix — don't stringify images, use postgres array syntax
    const imagesValue = images
      ? `{${images.map((i) => `"${i}"`).join(",")}}`
      : null;

    const { rows } = await q(
      `UPDATE supplier_products SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      category = COALESCE($3, category),
      unit = COALESCE($4, unit),
      price = COALESCE($5, price),
      min_order = COALESCE($6, min_order),
      available_quantity = COALESCE($7, available_quantity),
      images = COALESCE($8, images),
      is_available = COALESCE($9, is_available),
      updated_at = NOW()
     WHERE id = $10 AND supplier_id = $11 RETURNING *`,
      [
        name,
        description,
        category,
        unit,
        price,
        minOrder,
        availableQuantity,
        imagesValue,
        isAvailable,
        req.params.id,
        supplier[0].id,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/marketplace/supplier/products/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    await q("DELETE FROM supplier_products WHERE id=$1 AND supplier_id=$2", [
      req.params.id,
      supplier[0]?.id,
    ]);
    res.json({ success: true, message: "Product deleted" });
  }),
);

// ── MARKETPLACE ORDERS ────────────────────────────────────────
router.post(
  "/marketplace/orders",
  protect,
  asyncHandler(async (req, res) => {
    const {
      supplierId,
      projectId,
      items,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      notes,
      expectedDeliveryDate,
    } = req.body;

    if (!supplierId || !items?.length) {
      return res
        .status(400)
        .json({ success: false, message: "supplierId and items required" });
    }

    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      subtotal += Number(item.quantity) * Number(item.unitPrice);
    }
    const deliveryFee = 0; // Will be negotiated
    const total = subtotal + deliveryFee;

    // Generate order number
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM marketplace_orders WHERE company_id=$1",
      [req.user.companyId],
    );
    const orderNumber = `MKT-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;

    const { rows: orderRows } = await q(
      `INSERT INTO marketplace_orders
     (order_number, company_id, supplier_id, project_id, subtotal, delivery_fee, total,
      delivery_address, delivery_lat, delivery_lng, notes, expected_delivery_date, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        orderNumber,
        req.user.companyId,
        supplierId,
        projectId || null,
        subtotal,
        deliveryFee,
        total,
        deliveryAddress || null,
        deliveryLat || null,
        deliveryLng || null,
        notes || null,
        expectedDeliveryDate || null,
        req.user.userId,
      ],
    );

    const order = orderRows[0];

    // Insert items
    for (const item of items) {
      await q(
        `INSERT INTO marketplace_order_items
       (order_id, product_id, product_name, unit, quantity, unit_price, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.id,
          item.productId,
          item.productName,
          item.unit,
          item.quantity,
          item.unitPrice,
          Number(item.quantity) * Number(item.unitPrice),
        ],
      );
    }

    // Notify supplier via WhatsApp
    const { rows: supplierRows } = await q(
      "SELECT sp.*, u.email FROM supplier_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.id=$1",
      [supplierId],
    );
    if (supplierRows[0]?.whatsapp) {
      const msg = `🛒 New Order on Projex!\nOrder: ${orderNumber}\nTotal: ₦${total.toLocaleString("en-NG")}\nCheck your Projex dashboard to confirm.`;
      const whatsappUrl = `https://wa.me/${supplierRows[0].whatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(msg)}`;
      // Store notification
      await q(
        "INSERT INTO notifications (company_id, title, message, type) SELECT company_id, $1, $2, 'ORDER' FROM projects WHERE id=$3",
        [
          `New Order ${orderNumber}`,
          `Order placed with ${supplierRows[0].business_name}`,
          projectId,
        ],
      ).catch(() => {});
    }

    res.status(201).json({
      success: true,
      data: {
        ...order,
        whatsappUrl: supplierRows[0]?.whatsapp
          ? `https://wa.me/${supplierRows[0].whatsapp.replace(/[^0-9]/g, "")}`
          : null,
      },
    });
  }),
);

router.get(
  "/marketplace/orders",
  protect,
  asyncHandler(async (req, res) => {
    const { status, role } = req.query;

    let whereClause = "";
    let params = [];

    if (role === "supplier") {
      const { rows: supplier } = await q(
        "SELECT id FROM supplier_profiles WHERE user_id=$1",
        [req.user.userId],
      );
      if (!supplier[0]) return res.json({ success: true, data: [] });
      whereClause = "mo.supplier_id = $1";
      params = [supplier[0].id];
    } else {
      whereClause = "mo.company_id = $1";
      params = [req.user.companyId];
    }

    if (status) {
      whereClause += ` AND mo.status = $${params.length + 1}`;
      params.push(status);
    }

    const { rows } = await q(
      `SELECT mo.*,
      sp.business_name AS supplier_name, sp.whatsapp AS supplier_whatsapp,
      sp.city AS supplier_city, sp.phone AS supplier_phone,
      c.name AS company_name,
      (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
     FROM marketplace_orders mo
     JOIN supplier_profiles sp ON sp.id = mo.supplier_id
     JOIN companies c ON c.id = mo.company_id
     WHERE ${whereClause}
     ORDER BY mo.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.patch(
  "/marketplace/orders/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const validStatuses = [
      "CONFIRMED",
      "PREPARING",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
    ];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const updates = ["status = $1", "updated_at = NOW()"];
    const params = [status];

    if (status === "DELIVERED") {
      updates.push(`delivered_at = NOW()`);
    }
    if (status === "CONFIRMED") {
      updates.push(`confirmed_at = NOW()`);
    }

    params.push(req.params.id);

    const { rows } = await q(
      `UPDATE marketplace_orders SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// Add review after delivery
router.post(
  "/marketplace/orders/:id/review",
  protect,
  asyncHandler(async (req, res) => {
    const { rating, review } = req.body;
    const { rows: order } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1 AND company_id=$2",
      [req.params.id, req.user.companyId],
    );
    if (!order[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    const { rows } = await q(
      `INSERT INTO supplier_reviews (supplier_id, company_id, order_id, rating, review)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        order[0].supplier_id,
        req.user.companyId,
        req.params.id,
        rating,
        review || null,
      ],
    );

    // Update supplier rating
    await q(
      `UPDATE supplier_profiles SET
      rating = (SELECT AVG(rating) FROM supplier_reviews WHERE supplier_id = $1),
      total_reviews = (SELECT COUNT(*) FROM supplier_reviews WHERE supplier_id = $1),
      updated_at = NOW()
     WHERE id = $1`,
      [order[0].supplier_id],
    );

    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// ── MARKETPLACE PAYMENT ───────────────────────────────────────
router.post(
  "/billing/marketplace/initialize",
  protect,
  asyncHandler(async (req, res) => {
    const { amount, email, metadata } = req.body;
    if (!amount || !email) {
      return res
        .status(400)
        .json({ success: false, message: "amount and email required" });
    }

    const ref = `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let authUrl = null;

    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              amount: Math.round(amount * 100),
              reference: ref,
              currency: "NGN",
              metadata: {
                ...metadata,
                type: "MARKETPLACE",
                companyId: req.user.companyId,
              },
            }),
          },
        );
        const data = await r.json();
        if (data.status) authUrl = data.data.authorization_url;
      } catch (e) {
        logger.warn("Paystack marketplace init failed:", e.message);
      }
    }

    res.json({
      success: true,
      data: {
        authorizationUrl:
          authUrl || `https://paystack.com/pay/projex-marketplace`,
        reference: ref,
        amount,
      },
    });
  }),
);

router.post(
  "/billing/marketplace/verify",
  protect,
  asyncHandler(async (req, res) => {
    const { reference, orders } = req.body;
    let verified = false;
    let paystackData = null;

    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          `https://api.paystack.co/transaction/verify/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );
        paystackData = await r.json();
        verified =
          paystackData.status && paystackData.data?.status === "success";
      } catch (e) {
        logger.warn("Paystack marketplace verify failed:", e.message);
      }
    } else {
      verified = true; // dev mode
    }

    if (!verified) {
      return res
        .status(400)
        .json({ success: false, message: "Payment not verified" });
    }

    const { emitNewOrder } = require("../services/socket.service");
    const createdOrders = [];

    // Create orders and escrow for each supplier group
    for (const group of orders) {
      const subtotal = group.items.reduce(
        (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
        0,
      );
      // Fetch commission rate for this supplier
      const { rows: commRows } = await query(
        "SELECT * FROM commission_settings LIMIT 1",
      );
      const settings = commRows[0] || { global_rate: 3, minimum_amount: 500 };

      const { rows: supRows } = await query(
        "SELECT custom_commission_rate FROM supplier_profiles WHERE id = $1",
        [group.supplierId],
      );
      const rate = supRows[0]?.custom_commission_rate ?? settings.global_rate;
      const commissionAmount = Math.max(
        (subtotal * rate) / 100,
        settings.minimum_amount,
      );
      const supplierAmount = subtotal - commissionAmount;

      // Get supplier profile id
      const { rows: supplierRows } = await q(
        "SELECT id FROM supplier_profiles WHERE id=$1",
        [group.supplierId],
      );
      if (!supplierRows[0]) continue;

      // Generate order number
      const { rows: countRows } = await q(
        "SELECT COUNT(*) FROM marketplace_orders WHERE company_id=$1",
        [req.user.companyId],
      );
      const orderNumber = `MKT-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;

      // Create escrow transaction
      const { rows: escrowRows } = await q(
        `INSERT INTO escrow_transactions
       (order_id, company_id, supplier_id, amount, commission_rate, commission_amount,
        supplier_amount, status, paystack_reference, held_at)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, 'HOLDING', $7, NOW())
       RETURNING *`,
        [
          req.user.companyId,
          supplierRows[0].id,
          subtotal,
          rate,
          commissionAmount,
          supplierAmount,
          reference,
        ],
      );
      const escrow = escrowRows[0];

      // Create order
      const { rows: orderRows } = await q(
        `INSERT INTO marketplace_orders
       (order_number, company_id, supplier_id, project_id, subtotal, delivery_fee, total,
        delivery_address, notes, payment_status, payment_reference, escrow_id, status, created_by_id)
       VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,'PAID',$8,$9,'CONFIRMED',$10) RETURNING *`,
        [
          orderNumber,
          req.user.companyId,
          supplierRows[0].id,
          group.projectId || null,
          subtotal,
          group.deliveryAddress || null,
          group.notes || null,
          reference,
          escrow.id,
          req.user.userId,
        ],
      );
      const order = orderRows[0];

      // Update escrow with order id
      await q("UPDATE escrow_transactions SET order_id=$1 WHERE id=$2", [
        order.id,
        escrow.id,
      ]);

      // Insert items
      for (const item of group.items) {
        await q(
          `INSERT INTO marketplace_order_items
         (order_id, product_id, product_name, unit, quantity, unit_price, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            order.id,
            item.productId,
            item.productName,
            item.unit,
            item.quantity,
            item.unitPrice,
            Number(item.quantity) * Number(item.unitPrice),
          ],
        );
      }

      // Get full order with items
      const { rows: fullOrder } = await q(
        `SELECT mo.*, sp.business_name AS supplier_name, sp.whatsapp AS supplier_whatsapp,
        c.name AS company_name,
        (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
       FROM marketplace_orders mo
       JOIN supplier_profiles sp ON sp.id = mo.supplier_id
       JOIN companies c ON c.id = mo.company_id
       WHERE mo.id = $1`,
        [order.id],
      );

      // Emit socket event
      emitNewOrder(req.app, {
        order: fullOrder[0],
        supplierId: supplierRows[0].id,
        companyId: req.user.companyId,
      });

      createdOrders.push(fullOrder[0]);
    }

    res.json({ success: true, data: { orders: createdOrders, reference } });
  }),
);

// Confirm delivery — company side
router.patch(
  "/marketplace/orders/:id/confirm-delivery",
  protect,
  asyncHandler(async (req, res) => {
    const { emitOrderUpdate } = require("../services/socket.service");

    const { rows: orderRows } = await q(
      `SELECT mo.*, et.supplier_amount, et.id AS escrow_tx_id
     FROM marketplace_orders mo
     LEFT JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE mo.id = $1 AND mo.company_id = $2`,
      [req.params.id, req.user.companyId],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (orderRows[0].status !== "OUT_FOR_DELIVERY") {
      return res
        .status(400)
        .json({ success: false, message: "Order is not out for delivery" });
    }

    // Just mark as DELIVERED — escrow stays HOLDING until admin releases
    const { rows } = await q(
      `UPDATE marketplace_orders SET
      status = 'DELIVERED',
      delivered_at = NOW(),
      delivery_confirmed_at = NOW(),
      delivery_confirmed_by = $1,
      updated_at = NOW()
     WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.id],
    );

    // Emit order update only — NO escrow release here
    emitOrderUpdate(req.app, {
      order: rows[0],
      companyId: req.user.companyId,
      supplierId: orderRows[0].supplier_id,
    });

    res.json({
      success: true,
      data: rows[0],
      message:
        "Delivery confirmed. Payment will be released by Projex admin shortly.",
    });
  }),
);

// Cancel order — refund to company
router.patch(
  "/marketplace/orders/:id/cancel",
  protect,
  asyncHandler(async (req, res) => {
    const {
      emitOrderUpdate,
      emitPaymentUpdate,
    } = require("../services/socket.service");
    const { reason } = req.body;

    const { rows: orderRows } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1 AND (company_id=$2 OR $3=TRUE)",
      [
        req.params.id,
        req.user.companyId,
        req.user.role === "SUPER_ADMIN_PROJEX",
      ],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    const order = orderRows[0];

    if (["DELIVERED", "CANCELLED"].includes(order.status)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot cancel this order" });
    }

    // Update order
    const { rows } = await q(
      `UPDATE marketplace_orders SET
      status = 'CANCELLED', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    // Refund escrow
    if (order.escrow_id && order.payment_status === "PAID") {
      await q(
        `UPDATE escrow_transactions SET
        status = 'REFUNDED',
        refunded_at = NOW(),
        notes = $1,
        updated_at = NOW()
       WHERE id = $2`,
        [reason || "Order cancelled", order.escrow_id],
      );

      emitPaymentUpdate(req.app, {
        companyId: order.company_id,
        supplierId: order.supplier_id,
        payment: {
          orderId: order.id,
          orderNumber: order.order_number,
          amount: order.total,
          status: "REFUNDED",
          message: "Payment refunded to company",
        },
      });
    }

    emitOrderUpdate(req.app, {
      order: rows[0],
      companyId: order.company_id,
      supplierId: order.supplier_id,
    });

    res.json({
      success: true,
      data: rows[0],
      message: "Order cancelled. Payment will be refunded.",
    });
  }),
);

// ── SUPER ADMIN PROJEX ────────────────────────────────────────
const requireProjexAdmin = (req, res, next) => {
  if (req.user.role !== "SUPER_ADMIN_PROJEX") {
    return res
      .status(403)
      .json({ success: false, message: "Projex admin access required" });
  }
  next();
};

router.get(
  "/admin/dashboard",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const [
      { rows: orders },
      { rows: escrow },
      { rows: companies },
      { rows: suppliers },
      { rows: revenue },
    ] = await Promise.all([
      q(`SELECT COUNT(*) AS total,
       COUNT(CASE WHEN status='PENDING' THEN 1 END) AS pending,
       COUNT(CASE WHEN status='DELIVERED' THEN 1 END) AS delivered,
       COUNT(CASE WHEN status='CANCELLED' THEN 1 END) AS cancelled
       FROM marketplace_orders`),
      q(`SELECT COUNT(*) AS total,
       COUNT(CASE WHEN status='HOLDING' THEN 1 END) AS holding,
       COALESCE(SUM(CASE WHEN status='HOLDING' THEN amount END), 0) AS holding_amount,
       COALESCE(SUM(CASE WHEN status='RELEASED' THEN commission_amount END), 0) AS total_commission
       FROM escrow_transactions`),
      q(`SELECT COUNT(*) AS total,
       COUNT(CASE WHEN plan='PRO' THEN 1 END) AS pro,
       COUNT(CASE WHEN plan='ENTERPRISE' THEN 1 END) AS enterprise
       FROM companies`),
      q(`SELECT COUNT(*) AS total,
       COUNT(CASE WHEN is_verified=TRUE THEN 1 END) AS verified
       FROM supplier_profiles`),
      q(`SELECT COALESCE(SUM(commission_amount), 0) AS total_commission,
       COALESCE(SUM(amount), 0) AS total_gmv
       FROM escrow_transactions WHERE status='RELEASED'`),
    ]);

    res.json({
      success: true,
      data: {
        orders: orders[0],
        escrow: escrow[0],
        companies: companies[0],
        suppliers: suppliers[0],
        revenue: revenue[0],
      },
    });
  }),
);

router.get(
  "/admin/orders",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;
    const conds = ["1=1"];
    const params = [];
    let i = 1;

    if (status) {
      conds.push(`mo.status = $${i++}`);
      params.push(status);
    }
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await q(
      `SELECT mo.*,
      sp.business_name AS supplier_name,
      c.name AS company_name,
      et.status AS escrow_status,
      et.amount AS escrow_amount,
      et.commission_amount,
      et.supplier_amount,
      et.held_at, et.released_at, et.refunded_at,
      (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
     FROM marketplace_orders mo
     JOIN supplier_profiles sp ON sp.id = mo.supplier_id
     JOIN companies c ON c.id = mo.company_id
     LEFT JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE ${conds.join(" AND ")}
     ORDER BY mo.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/admin/orders/:id/release",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      emitPaymentUpdate,
      initiateSupplierPayout,
    } = require("../services/socket.service");

    const { rows: orderRows } = await q(
      `SELECT mo.*, et.amount, et.commission_amount, et.supplier_amount,
      et.id AS escrow_tx_id, et.status AS escrow_status
     FROM marketplace_orders mo
     JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE mo.id = $1`,
      [req.params.id],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    const order = orderRows[0];

    if (order.status !== "DELIVERED") {
      return res.status(400).json({
        success: false,
        message: `Cannot release payment — order is ${order.status}. Company must confirm delivery first.`,
      });
    }

    if (order.escrow_status === "RELEASED") {
      return res
        .status(400)
        .json({ success: false, message: "Payment already released" });
    }

    // Get supplier bank details for manual payout message
    const { rows: supplierBankRows } = await q(
      "SELECT bank_name, account_number, account_name FROM supplier_profiles WHERE id=$1",
      [order.supplier_id],
    );
    const supplier = supplierBankRows[0];

    // Initiate payout
    const payout = await initiateSupplierPayout(
      order.supplier_id,
      Number(order.supplier_amount),
      order.order_number,
      order.payment_reference,
    );

    // Manual payout required
    if (!payout.success && payout.manual) {
      await q(
        `UPDATE escrow_transactions SET
        status = 'RELEASED',
        released_at = NOW(),
        released_by = $1,
        notes = $2,
        updated_at = NOW()
       WHERE id = $3`,
        [
          req.user.userId,
          `Manual payout required: ${payout.message}`,
          order.escrow_tx_id,
        ],
      );

      await q(
        "UPDATE marketplace_orders SET escrow_released=TRUE, updated_at=NOW() WHERE id=$1",
        [req.params.id],
      );

      emitPaymentUpdate(req.app, {
        companyId: order.company_id,
        supplierId: order.supplier_id,
        payment: {
          orderId: order.id,
          orderNumber: order.order_number,
          amount: order.supplier_amount,
          status: "RELEASED",
          message: `Payment approved. Manual bank transfer required.`,
        },
      });

      return res.json({
        success: true,
        message: `⚠️ Payment approved but requires manual transfer:\n${payout.message}\n\nPlease transfer ₦${Number(order.supplier_amount).toLocaleString("en-NG")} to:\nBank: ${supplier?.bank_name || "N/A"}\nAccount: ${supplier?.account_number || "N/A"}\nName: ${supplier?.account_name || "N/A"}`,
        data: { manual: true },
      });
    }

    if (!payout.success) {
      return res.status(500).json({
        success: false,
        message: payout.message || "Transfer failed",
      });
    }

    // Successful transfer
    await q(
      `UPDATE escrow_transactions SET
      status = 'RELEASED',
      released_at = NOW(),
      released_by = $1,
      paystack_transfer_code = $2,
      updated_at = NOW()
     WHERE id = $3`,
      [req.user.userId, payout.transferCode, order.escrow_tx_id],
    );

    await q(
      "UPDATE marketplace_orders SET escrow_released=TRUE, updated_at=NOW() WHERE id=$1",
      [req.params.id],
    );

    emitPaymentUpdate(req.app, {
      companyId: order.company_id,
      supplierId: order.supplier_id,
      payment: {
        orderId: order.id,
        orderNumber: order.order_number,
        amount: order.supplier_amount,
        status: "RELEASED",
        transferCode: payout.transferCode,
        message: `₦${Number(order.supplier_amount).toLocaleString("en-NG")} sent to supplier`,
      },
    });

    res.json({
      success: true,
      message: `✓ ₦${Number(order.supplier_amount).toLocaleString("en-NG")} transfer initiated to supplier.`,
      data: { transferCode: payout.transferCode },
    });
  }),
);

router.post(
  "/admin/orders/:id/refund",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { emitPaymentUpdate } = require("../services/socket.service");
    const { reason } = req.body;

    const { rows: orderRows } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1",
      [req.params.id],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    const order = orderRows[0];

    await q(
      `UPDATE escrow_transactions SET status='REFUNDED', refunded_at=NOW(),
     notes=$1, updated_at=NOW() WHERE id=$2`,
      [reason || "Admin refund", order.escrow_id],
    );

    await q(
      "UPDATE marketplace_orders SET status='CANCELLED', updated_at=NOW() WHERE id=$1",
      [req.params.id],
    );

    emitPaymentUpdate(req.app, {
      companyId: order.company_id,
      supplierId: order.supplier_id,
      payment: {
        orderId: order.id,
        status: "REFUNDED",
        message: "Payment refunded by admin",
      },
    });

    res.json({
      success: true,
      message: "Order cancelled and payment refunded",
    });
  }),
);

router.get(
  "/admin/escrow",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT et.*,
      mo.order_number, mo.status AS order_status,
      c.name AS company_name, c.email AS company_email,
      sp.business_name AS supplier_name
     FROM escrow_transactions et
     JOIN marketplace_orders mo ON mo.id = et.order_id
     JOIN companies c ON c.id = et.company_id
     JOIN supplier_profiles sp ON sp.id = et.supplier_id
     ORDER BY et.created_at DESC
     LIMIT 100`,
    );
    res.json({ success: true, data: rows });
  }),
);

router.get(
  "/admin/suppliers",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*, u.email, u.first_name, u.last_name, u.created_at AS user_created,
      COUNT(DISTINCT p.id) AS product_count,
      COUNT(DISTINCT mo.id) AS order_count,
      COALESCE(SUM(et.supplier_amount) FILTER (WHERE et.status='RELEASED'), 0) AS total_earned
     FROM supplier_profiles sp
     JOIN users u ON u.id = sp.user_id
     LEFT JOIN supplier_products p ON p.supplier_id = sp.id
     LEFT JOIN marketplace_orders mo ON mo.supplier_id = sp.id
     LEFT JOIN escrow_transactions et ON et.supplier_id = sp.id
     GROUP BY sp.id, u.email, u.first_name, u.last_name, u.created_at
     ORDER BY sp.created_at DESC`,
    );
    res.json({ success: true, data: rows });
  }),
);

router.patch(
  "/admin/suppliers/:id/verify",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE supplier_profiles SET is_verified=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.body.verified, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.get(
  "/admin/companies",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT c.*,
      COUNT(DISTINCT p.id) AS project_count,
      COUNT(DISTINCT u.id) AS user_count,
      COUNT(DISTINCT mo.id) AS order_count
     FROM companies c
     LEFT JOIN projects p ON p.company_id = c.id
     LEFT JOIN users u ON u.company_id = c.id
     LEFT JOIN marketplace_orders mo ON mo.company_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/marketplace/supplier/verify-bank",
  protect,
  asyncHandler(async (req, res) => {
    const { accountNumber, bankCode } = req.body;

    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );
        const data = await r.json();
        if (data.status) {
          return res.json({ success: true, data: data.data });
        }
        return res.status(400).json({
          success: false,
          message: data.message || "Could not verify account",
        });
      } catch (e) {
        return res
          .status(500)
          .json({ success: false, message: "Verification failed" });
      }
    }

    // Dev mode — return mock
    res.json({
      success: true,
      data: {
        account_name: "TEST ACCOUNT NAME",
        account_number: accountNumber,
      },
    });
  }),
);

router.patch(
  "/marketplace/supplier/me",
  protect,
  asyncHandler(async (req, res) => {
    const {
      businessName,
      description,
      address,
      city,
      state,
      latitude,
      longitude,
      deliveryRadiusKm,
      whatsapp,
      phone,
      categories,
      logoUrl,
      bannerUrl,
      bankName,
      bankCode,
      accountNumber,
      accountName,
    } = req.body;

    // Create Paystack transfer recipient if bank details provided
    let recipientCode = null;
    if (
      accountNumber &&
      bankCode &&
      accountName &&
      process.env.PAYSTACK_SECRET_KEY
    ) {
      try {
        const r = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "nuban",
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: "NGN",
          }),
        });
        const data = await r.json();
        if (data.status) {
          recipientCode = data.data?.recipient_code;
          logger.info(`Paystack recipient created: ${recipientCode}`);
        }
      } catch (e) {
        logger.warn("Failed to create Paystack recipient:", e.message);
      }
    }

    const { rows } = await q(
      `UPDATE supplier_profiles SET
      business_name = COALESCE($1, business_name),
      description = COALESCE($2, description),
      address = COALESCE($3, address),
      city = COALESCE($4, city),
      state = COALESCE($5, state),
      latitude = COALESCE($6, latitude),
      longitude = COALESCE($7, longitude),
      delivery_radius_km = COALESCE($8, delivery_radius_km),
      whatsapp = COALESCE($9, whatsapp),
      phone = COALESCE($10, phone),
      categories = COALESCE($11, categories),
      logo_url = COALESCE($12, logo_url),
      banner_url = COALESCE($13, banner_url),
      bank_name = COALESCE($14, bank_name),
      bank_code = COALESCE($15, bank_code),
      account_number = COALESCE($16, account_number),
      account_name = COALESCE($17, account_name),
      paystack_recipient_code = COALESCE($18, paystack_recipient_code),
      updated_at = NOW()
     WHERE user_id = $19 RETURNING *`,
      [
        businessName,
        description,
        address,
        city,
        state,
        latitude,
        longitude,
        deliveryRadiusKm,
        whatsapp,
        phone,
        categories,
        logoUrl,
        bannerUrl,
        bankName,
        bankCode,
        accountNumber,
        accountName,
        recipientCode,
        req.user.userId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── COMMISSION ──────────────────────────────────────────────────────────────
router.get(
  "/admin/commission",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query("SELECT * FROM commission_settings LIMIT 1");
    res.json({
      success: true,
      data: rows[0] || { global_rate: 3, minimum_amount: 500 },
    });
  }),
);

router.put(
  "/admin/commission",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { globalRate, minimumAmount } = req.body;
    const { rows } = await query(
      `INSERT INTO commission_settings (global_rate, minimum_amount, updated_by, updated_at, singleton)
     VALUES ($1, $2, $3, NOW(), true)
     ON CONFLICT (singleton) DO UPDATE
       SET global_rate = $1, minimum_amount = $2, updated_by = $3, updated_at = NOW()
     RETURNING *`,
      [globalRate, minimumAmount, req.user.userId],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/admin/commission/supplier/:supplierId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rate, note } = req.body;
    const { rows } = await query(
      `UPDATE supplier_profiles
     SET custom_commission_rate = $1, commission_note = $2
     WHERE id = $3 RETURNING *`,
      [rate ?? null, note || null, req.params.supplierId],
    );
    if (!rows.length) throw new AppError("Supplier not found", 404);
    res.json({ success: true, data: rows[0] });
  }),
);

// ── PLANS ─────────────────────────────────────────────────────
router.get(
  "/plans",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      "SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC",
    );
    const plans = rows.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency,
      interval: p.interval,
      description: p.description,
      maxProjects: p.max_projects,
      maxUsers: p.max_users,
      features: p.features,
      isFree: p.is_free,
      isPopular: p.is_popular,
    }));
    res.json({ success: true, data: plans });
  }),
);

// ── ADMIN PLAN MANAGEMENT ──────────────────────────────────────────────────
router.get(
  "/admin/plans",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query("SELECT * FROM plans ORDER BY sort_order ASC");
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/admin/plans",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      id,
      name,
      price,
      description,
      maxProjects,
      maxUsers,
      features,
      isFree,
      isPopular,
      sortOrder,
    } = req.body;
    const { rows } = await query(
      `INSERT INTO plans (id, name, price, description, max_projects, max_users, features, is_free, is_popular, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
      [
        id.toUpperCase(),
        name,
        price || 0,
        description || null,
        maxProjects,
        maxUsers,
        JSON.stringify(features || []),
        isFree || false,
        isPopular || false,
        sortOrder || 0,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/admin/plans/:planId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      price,
      description,
      maxProjects,
      maxUsers,
      features,
      isFree,
      isPopular,
      isActive,
      sortOrder,
    } = req.body;
    const { rows } = await query(
      `UPDATE plans SET
      name = COALESCE($1, name),
      price = COALESCE($2, price),
      description = COALESCE($3, description),
      max_projects = COALESCE($4, max_projects),
      max_users = COALESCE($5, max_users),
      features = COALESCE($6, features),
      is_free = COALESCE($7, is_free),
      is_popular = COALESCE($8, is_popular),
      is_active = COALESCE($9, is_active),
      sort_order = COALESCE($10, sort_order),
      updated_at = NOW()
     WHERE id = $11 RETURNING *`,
      [
        name,
        price,
        description,
        maxProjects,
        maxUsers,
        features ? JSON.stringify(features) : null,
        isFree,
        isPopular,
        isActive,
        sortOrder,
        req.params.planId,
      ],
    );
    if (!rows.length) throw new AppError("Plan not found", 404);
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/admin/plans/:planId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    // Soft delete only — never hard delete a plan
    const { rows } = await query(
      "UPDATE plans SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id",
      [req.params.planId],
    );
    if (!rows.length) throw new AppError("Plan not found", 404);
    res.json({ success: true, message: "Plan deactivated" });
  }),
);

// Admin override a company's plan without payment
router.put(
  "/admin/companies/:companyId/plan",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { planId, trialDays, note } = req.body;

    const { rows: planRows } = await query(
      "SELECT * FROM plans WHERE id = $1",
      [planId],
    );
    if (!planRows.length) throw new AppError("Plan not found", 404);
    const plan = planRows[0];

    const trialEndsAt = trialDays
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      : null;

    const { rows } = await query(
      `UPDATE companies SET
      plan = $1,
      max_projects = $2,
      max_users = $3,
      plan_expires_at = $4,
      trial_ends_at = $5,
      plan_override_by = $6,
      plan_override_note = $7,
      updated_at = NOW()
     WHERE id = $8 RETURNING *`,
      [
        plan.id,
        plan.max_projects,
        plan.max_users,
        trialEndsAt,
        trialEndsAt,
        req.user.userId,
        note || null,
        req.params.companyId,
      ],
    );
    if (!rows.length) throw new AppError("Company not found", 404);
    res.json({
      success: true,
      data: rows[0],
      message: `Plan updated to ${plan.name}`,
    });
  }),
);

// ── ADMIN SUBSCRIPTION REVENUE ─────────────────────────────────────────────
router.get(
  "/admin/payments",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, plan, status } = req.query;
    const offset = (page - 1) * limit;

    let where = "WHERE p.status = 'success'";
    const params = [];

    if (plan) {
      params.push(plan);
      where += ` AND s.plan = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }

    params.push(limit, offset);

    const { rows: payments } = await query(
      `SELECT
       p.id, p.amount, p.status, p.paid_at, p.paystack_ref,
       p.created_at, p.metadata,
       s.plan, s.started_at, s.expires_at,
       c.name AS company_name,
       u.email AS company_email,
       u.first_name, u.last_name
     FROM payments p
     LEFT JOIN subscriptions s ON s.id = p.subscription_id
     LEFT JOIN companies c ON c.id = p.company_id
     LEFT JOIN users u ON u.company_id = p.company_id AND u.role = 'PROJECT_OWNER'
     ${where}
     ORDER BY p.paid_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: stats } = await query(
      `SELECT
       COUNT(*) FILTER (WHERE status = 'success') AS total_payments,
       COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total_revenue,
       COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND paid_at >= date_trunc('month', NOW())), 0) AS this_month,
       COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND paid_at >= date_trunc('month', NOW()) - interval '1 month'
         AND paid_at < date_trunc('month', NOW())), 0) AS last_month,
       COUNT(DISTINCT company_id) FILTER (WHERE status = 'success') AS paying_companies
     FROM payments`,
    );

    res.json({ success: true, data: { payments, stats: stats[0] } });
  }),
);

// ── PLATFORM SETTINGS ──────────────────────────────────────────────────────
router.get(
  "/admin/settings",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      "SELECT * FROM platform_settings ORDER BY key ASC",
    );
    res.json({ success: true, data: rows });
  }),
);

router.put(
  "/admin/settings/:key",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { value } = req.body;
    const { rows } = await query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()
     RETURNING *`,
      [req.params.key, String(value), req.user.userId],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// Public — supplier app reads prices
router.get(
  "/settings/featured-pricing",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      "SELECT key, value FROM platform_settings WHERE key IN ('featured_store_price_monthly', 'featured_product_price_weekly')",
    );
    const pricing = {};
    rows.forEach((r) => {
      pricing[r.key] = parseInt(r.value);
    });
    res.json({ success: true, data: pricing });
  }),
);

// ── FEATURED PLACEMENT ─────────────────────────────────────────────────────

// Supplier: initialize payment for featured placement
router.post(
  "/supplier/featured/initialize",
  protect,
  asyncHandler(async (req, res) => {
    const { type, productId, autoRenew } = req.body;
    if (!["STORE", "PRODUCT"].includes(type))
      throw new AppError("Invalid type", 400);
    if (type === "PRODUCT" && !productId)
      throw new AppError("productId required for PRODUCT type", 400);

    // Get supplier profile
    const { rows: spRows } = await query(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    if (!spRows.length) throw new AppError("Supplier profile not found", 404);
    const supplierId = spRows[0].id;

    // Get pricing
    const priceKey =
      type === "STORE"
        ? "featured_store_price_monthly"
        : "featured_product_price_weekly";
    const { rows: priceRows } = await query(
      "SELECT value FROM platform_settings WHERE key = $1",
      [priceKey],
    );
    const amount = parseInt(
      priceRows[0]?.value || (type === "STORE" ? "15000" : "5000"),
    );
    const durationDays = type === "STORE" ? 30 : 7;

    // Check no active placement of same type
    const { rows: existing } = await query(
      `SELECT id FROM featured_placements
     WHERE supplier_id = $1 AND type = $2
     AND is_active = true AND ends_at > NOW()
     AND ($3::uuid IS NULL OR product_id = $3)`,
      [supplierId, type, productId || null],
    );
    if (existing.length)
      throw new AppError(`You already have an active ${type} placement`, 400);

    // Get supplier email for Paystack
    const { rows: userRows } = await query(
      "SELECT email FROM users WHERE id = $1",
      [req.user.userId],
    );

    // Initialize Paystack payment
    const reference = `feat_${type.toLowerCase()}_${supplierId}_${Date.now()}`;
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userRows[0].email,
          amount: amount * 100,
          reference,
          metadata: {
            type,
            supplierId,
            productId: productId || null,
            autoRenew: autoRenew || false,
            durationDays,
            featurePlacement: true,
          },
          callback_url: `${process.env.FRONTEND_URL}/supplier/featured/verify`,
        }),
      },
    );
    const paystackData = await paystackRes.json();
    if (!paystackData.status)
      throw new AppError("Payment initialization failed", 500);

    // Create pending placement record
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const { rows: placementRows } = await query(
      `INSERT INTO featured_placements
       (type, supplier_id, product_id, starts_at, ends_at, duration_days,
        amount_paid, payment_reference, payment_status, auto_renew, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, false)
     RETURNING *`,
      [
        type,
        supplierId,
        productId || null,
        now,
        endsAt,
        durationDays,
        amount,
        reference,
        autoRenew || false,
      ],
    );
    const placement = placementRows[0];

    // Record pending payment
    await query(
      `INSERT INTO featured_placement_payments
       (featured_placement_id, supplier_id, paystack_ref, amount, status, period_start, period_end)
     VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)`,
      [placement.id, supplierId, reference, amount, now, endsAt],
    );

    res.json({
      success: true,
      data: {
        authorizationUrl: paystackData.data.authorization_url,
        reference,
        amount,
        placementId: placement.id,
      },
    });
  }),
);

// Supplier: verify payment after redirect
router.post(
  "/supplier/featured/verify",
  protect,
  asyncHandler(async (req, res) => {
    const { reference } = req.body;

    // Verify with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== "success") {
      throw new AppError("Payment verification failed", 400);
    }

    const authCode =
      paystackData.data.authorization?.authorization_code || null;

    // Activate placement
    const { rows: placementRows } = await query(
      `UPDATE featured_placements SET
       payment_status = 'SUCCESS',
       paystack_authorization_code = $1,
       is_active = true,
       updated_at = NOW()
     WHERE payment_reference = $2
     RETURNING *`,
      [authCode, reference],
    );
    if (!placementRows.length) throw new AppError("Placement not found", 404);
    const placement = placementRows[0];

    // Update payment record
    await query(
      `UPDATE featured_placement_payments SET
       status = 'SUCCESS',
       paystack_authorization_code = $1,
       paid_at = NOW()
     WHERE paystack_ref = $2`,
      [authCode, reference],
    );

    // If product placement, mark product as featured
    if (placement.product_id) {
      await query(
        "UPDATE supplier_products SET is_featured = true WHERE id = $1",
        [placement.product_id],
      );
    }

    res.json({
      success: true,
      data: placement,
      message: "Placement activated successfully",
    });
  }),
);

// Supplier: get my active placements
router.get(
  "/supplier/featured",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: spRows } = await query(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    if (!spRows.length) throw new AppError("Supplier not found", 404);

    const { rows } = await query(
      `SELECT fp.*, fpp.paid_at, fpp.amount AS last_payment_amount
     FROM featured_placements fp
     LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id
       AND fpp.status = 'SUCCESS'
     WHERE fp.supplier_id = $1
     ORDER BY fp.created_at DESC`,
      [spRows[0].id],
    );
    res.json({ success: true, data: rows });
  }),
);

// Supplier: cancel auto-renew
router.put(
  "/supplier/featured/:placementId/cancel",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: spRows } = await query(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    const { rows } = await query(
      `UPDATE featured_placements SET auto_renew = false, cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND supplier_id = $2 RETURNING *`,
      [req.params.placementId, spRows[0]?.id],
    );
    if (!rows.length) throw new AppError("Placement not found", 404);
    res.json({
      success: true,
      message: "Auto-renew cancelled. Placement runs until expiry.",
    });
  }),
);

// ── ADMIN FEATURED PLACEMENT MANAGEMENT ───────────────────────────────────

// Admin: get all placements with revenue stats
router.get(
  "/admin/featured",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows: placements } = await query(
      `SELECT fp.*,
       sp.business_name  AS supplier_name,
       sp2.name AS product_name,
       COUNT(fpp.id) FILTER (WHERE fpp.status = 'SUCCESS') AS payment_count,
       COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS'), 0) AS total_earned
     FROM featured_placements fp
     LEFT JOIN supplier_profiles sp ON sp.id = fp.supplier_id
     LEFT JOIN supplier_products sp2 ON sp2.id = fp.product_id
     LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id
     GROUP BY fp.id, sp.business_name , sp2.name
     ORDER BY fp.created_at DESC`,
    );

    const { rows: stats } = await query(
      `SELECT
       COUNT(*) FILTER (WHERE is_active = true AND ends_at > NOW()) AS active_placements,
       COUNT(*) FILTER (WHERE type = 'STORE' AND is_active = true AND ends_at > NOW()) AS active_stores,
       COUNT(*) FILTER (WHERE type = 'PRODUCT' AND is_active = true AND ends_at > NOW()) AS active_products,
       COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS'), 0) AS total_revenue,
       COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS' AND fpp.paid_at >= date_trunc('month', NOW())), 0) AS this_month
     FROM featured_placements fp
     LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id`,
    );

    res.json({ success: true, data: { placements, stats: stats[0] } });
  }),
);

// Admin: grant free placement
router.post(
  "/admin/featured/grant",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { supplierId, type, productId, durationDays, notes } = req.body;
    if (!["STORE", "PRODUCT"].includes(type))
      throw new AppError("Invalid type", 400);

    const now = new Date();
    const endsAt = new Date(
      now.getTime() + (durationDays || 30) * 24 * 60 * 60 * 1000,
    );

    const { rows } = await query(
      `INSERT INTO featured_placements
       (type, supplier_id, product_id, starts_at, ends_at, duration_days,
        amount_paid, payment_status, is_active, is_free, granted_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'SUCCESS', true, true, $7, $8)
     RETURNING *`,
      [
        type,
        supplierId,
        productId || null,
        now,
        endsAt,
        durationDays || 30,
        req.user.userId,
        notes || null,
      ],
    );
    const placement = rows[0];

    // Record as free payment
    await query(
      `INSERT INTO featured_placement_payments
       (featured_placement_id, supplier_id, amount, status, period_start, period_end, is_free, granted_by, paid_at)
     VALUES ($1, $2, 0, 'SUCCESS', $3, $4, true, $5, NOW())`,
      [placement.id, supplierId, now, endsAt, req.user.userId],
    );

    // If product, mark as featured
    if (productId) {
      await query(
        "UPDATE supplier_products SET is_featured = true WHERE id = $1",
        [productId],
      );
    }

    res.status(201).json({
      success: true,
      data: placement,
      message: "Placement granted successfully",
    });
  }),
);

// Admin: deactivate a placement early
router.put(
  "/admin/featured/:placementId/deactivate",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE featured_placements SET is_active = false, cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1 RETURNING *, product_id`,
      [req.params.placementId],
    );
    if (!rows.length) throw new AppError("Placement not found", 404);

    if (rows[0].product_id) {
      await query(
        "UPDATE supplier_products SET is_featured = false WHERE id = $1",
        [rows[0].product_id],
      );
    }

    res.json({ success: true, message: "Placement deactivated" });
  }),
);

// Cron-style: auto-expire placements (call this from a cron job or on each request)
router.post(
  "/admin/featured/expire",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    // Deactivate expired placements
    const { rows: expired } = await query(
      `UPDATE featured_placements SET is_active = false, updated_at = NOW()
     WHERE is_active = true AND ends_at < NOW()
     RETURNING id, product_id`,
    );

    // Remove featured flag from expired products
    for (const p of expired) {
      if (p.product_id) {
        await query(
          "UPDATE supplier_products SET is_featured = false WHERE id = $1",
          [p.product_id],
        );
      }
    }

    res.json({
      success: true,
      message: `${expired.length} placements expired`,
    });
  }),
);

// ── ADS ────────────────────────────────────────────────────────────────────

// Public — mobile app fetches active ads by placement
router.get(
  "/ads",
  asyncHandler(async (req, res) => {
    const { placement } = req.query;
    const conds = ["is_active = TRUE", "starts_at <= NOW()", "ends_at > NOW()"];
    const params = [];

    if (placement) {
      params.push(placement);
      conds.push(`placement = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT id, title, description, image_url, link_url, placement, advertiser_name
     FROM advertisements
     WHERE ${conds.join(" AND ")}
     ORDER BY amount_paid DESC, created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// Public — track impression (fire and forget)
router.post(
  "/ads/:id/impression",
  asyncHandler(async (req, res) => {
    await query(
      "UPDATE advertisements SET impressions = impressions + 1 WHERE id = $1",
      [req.params.id],
    );
    res.json({ success: true });
  }),
);

// Public — track click
router.post(
  "/ads/:id/click",
  asyncHandler(async (req, res) => {
    await query("UPDATE advertisements SET clicks = clicks + 1 WHERE id = $1", [
      req.params.id,
    ]);
    res.json({ success: true });
  }),
);

// Admin — get all ads with stats
router.get(
  "/admin/ads",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT *, 
       CASE WHEN is_active AND starts_at <= NOW() AND ends_at > NOW() THEN 'LIVE'
            WHEN ends_at <= NOW() THEN 'EXPIRED'
            WHEN starts_at > NOW() THEN 'SCHEDULED'
            ELSE 'INACTIVE' END AS status
     FROM advertisements
     ORDER BY created_at DESC`,
    );

    const { rows: stats } = await query(
      `SELECT
       COUNT(*) FILTER (WHERE is_active AND ends_at > NOW()) AS live_ads,
       COALESCE(SUM(amount_paid), 0) AS total_revenue,
       COALESCE(SUM(impressions), 0) AS total_impressions,
       COALESCE(SUM(clicks), 0) AS total_clicks
     FROM advertisements`,
    );

    res.json({ success: true, data: { ads: rows, stats: stats[0] } });
  }),
);

// Admin — create ad
router.post(
  "/admin/ads",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      imageUrl,
      linkUrl,
      placement,
      advertiserName,
      advertiserContact,
      amountPaid,
      startsAt,
      endsAt,
    } = req.body;

    const { rows } = await query(
      `INSERT INTO advertisements
       (title, description, image_url, link_url, placement,
        advertiser_name, advertiser_contact, amount_paid,
        starts_at, ends_at, is_active, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE, $11)
     RETURNING *`,
      [
        title,
        description || null,
        imageUrl,
        linkUrl || null,
        placement,
        advertiserName,
        advertiserContact || null,
        amountPaid || 0,
        startsAt,
        endsAt,
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// Admin — update ad
router.put(
  "/admin/ads/:id",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      imageUrl,
      linkUrl,
      placement,
      advertiserName,
      advertiserContact,
      amountPaid,
      startsAt,
      endsAt,
      isActive,
    } = req.body;

    const { rows } = await query(
      `UPDATE advertisements SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       image_url = COALESCE($3, image_url),
       link_url = COALESCE($4, link_url),
       placement = COALESCE($5, placement),
       advertiser_name = COALESCE($6, advertiser_name),
       advertiser_contact = COALESCE($7, advertiser_contact),
       amount_paid = COALESCE($8, amount_paid),
       starts_at = COALESCE($9, starts_at),
       ends_at = COALESCE($10, ends_at),
       is_active = COALESCE($11, is_active),
       updated_at = NOW()
     WHERE id = $12 RETURNING *`,
      [
        title,
        description,
        imageUrl,
        linkUrl,
        placement,
        advertiserName,
        advertiserContact,
        amountPaid,
        startsAt,
        endsAt,
        isActive,
        req.params.id,
      ],
    );
    if (!rows.length) throw new AppError("Ad not found", 404);
    res.json({ success: true, data: rows[0] });
  }),
);

// Admin — delete ad
router.delete(
  "/admin/ads/:id",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    await query("DELETE FROM advertisements WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Ad deleted" });
  }),
);

module.exports = router;
