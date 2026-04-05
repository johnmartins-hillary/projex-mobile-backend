const { asyncHandler } = require("../middleware");
const {
  userRepo,
  companyRepo,
  projectRepo,
  materialRepo,
  equipmentRepo,
  budgetRepo,
  expenseRepo,
  visitorRepo,
  attendanceRepo,
  notificationRepo,
  dashboardRepo,
  syncRepo,
} = require("../repositories");
const {
  NotFoundError,
  AppError,
  PlanLimitError,
  ConflictError,
} = require("../utils/errors");
const {
  notifyLowStock,
  notifyBudgetAlert,
  notifyMaintenance,
} = require("../services");
const authService = require("../services/auth.service");
const { query, withTransaction } = require("../config/database");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const Anthropic = require("@anthropic-ai/sdk");
const bcrypt = require("bcryptjs");
const { sendEmail, emailTemplates } = require("../services/email.service");

// ── AUTH ──────────────────────────────────────────────────────
exports.auth = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    if (result) {
      const template = emailTemplates.welcome(
        result.user.firstName, // ← use result.user not undefined 'user'
        result.user.company?.name || req.body.companyName,
        "STARTER",
      );
      sendEmail({
        to: result.user.email, // ← use result.user.email
        subject: template.subject,
        html: template.html,
      }).catch(() => {});
    }
    res
      .status(201)
      .json({ success: true, message: "Account created", data: result });
  }),
  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json({ success: true, message: "Login successful", data: result });
  }),
  refresh: asyncHandler(async (req, res) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.json({ success: true, data: tokens });
  }),
  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.user.userId);
    res.json({ success: true, message: "Logged out" });
  }),
  forgotPassword: asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email);
    res.json({
      success: true,
      message: "If that email exists, a reset link was sent.",
    });
  }),
  resetPassword: asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, message: "Password reset successfully." });
  }),
  getMe: asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.user.userId);
    if (!user) throw new NotFoundError("User");
    const company = await companyRepo.findById(user.company_id);
    res.json({ success: true, data: authService.formatUser(user, company) });
  }),
  updatePushToken: asyncHandler(async (req, res) => {
    await userRepo.updatePushToken(req.user.userId, req.body.pushToken);
    res.json({ success: true });
  }),
};

// ── DASHBOARD ─────────────────────────────────────────────────
exports.dashboard = {
  getSummary: asyncHandler(async (req, res) => {
    const data = await dashboardRepo.getSummary(
      req.user.companyId,
      req.query.projectId,
    );
    const projects = data.projects.map((p) => ({
      ...p,
      percent_spent:
        p.total_allocated > 0
          ? Math.round((p.total_spent / p.total_allocated) * 100)
          : 0,
      remaining: p.total_allocated - p.total_spent,
    }));
    res.json({ success: true, data: { ...data, projects } });
  }),
};

// ── PROJECTS ──────────────────────────────────────────────────
exports.projects = {
  getAll: asyncHandler(async (req, res) => {
    const projects = await projectRepo.findByCompanyWithStats(
      req.user.companyId,
    );
    res.json({ success: true, data: projects });
  }),
  getOne: asyncHandler(async (req, res) => {
    const project = await projectRepo.findByIdWithMembers(
      req.params.id,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    res.json({ success: true, data: project });
  }),
  create: asyncHandler(async (req, res) => {
    const company = await companyRepo.findById(req.user.companyId);
    const active = await projectRepo.count({
      company_id: req.user.companyId,
      status: "ACTIVE",
    });
    if (active >= company.max_projects)
      throw new PlanLimitError(
        `${company.plan} plan allows max ${company.max_projects} active projects. Upgrade to add more.`,
      );
    const project = await projectRepo.create(
      { ...req.body, companyId: req.user.companyId },
      req.user.userId,
    );
    res
      .status(201)
      .json({ success: true, message: "Project created", data: project });
  }),
  update: asyncHandler(async (req, res) => {
    const existing = await projectRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Project");
    const updated = await projectRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),
  delete: asyncHandler(async (req, res) => {
    const existing = await projectRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Project");
    await projectRepo.deleteById(req.params.id);
    res.json({ success: true, message: "Project deleted" });
  }),
};

// ── MATERIALS ─────────────────────────────────────────────────
exports.materials = {
  getAll: asyncHandler(async (req, res) => {
    const { search, category, status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const items = await materialRepo.findByCompanyFiltered(req.user.companyId, {
      search,
      category,
      status,
      limit: parseInt(limit),
      offset,
    });
    res.json({
      success: true,
      data: items,
      meta: { page: parseInt(page), limit: parseInt(limit) },
    });
  }),
  getOne: asyncHandler(async (req, res) => {
    const m = await materialRepo.findByIdWithLedger(
      req.params.id,
      req.user.companyId,
    );
    if (!m) throw new NotFoundError("Material");
    res.json({ success: true, data: m });
  }),
  create: asyncHandler(async (req, res) => {
    const m = await materialRepo.create({
      ...req.body,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: m });
  }),
  update: asyncHandler(async (req, res) => {
    const existing = await materialRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Material");
    const updated = await materialRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),
  delete: asyncHandler(async (req, res) => {
    const existing = await materialRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Material");
    await materialRepo.deleteById(req.params.id);
    res.json({ success: true, message: "Material deleted" });
  }),
  getLowStock: asyncHandler(async (req, res) => {
    const items = await materialRepo.getLowStock(req.user.companyId);
    res.json({ success: true, data: items });
  }),
  stockIn: asyncHandler(async (req, res) => {
    const m = await materialRepo.findById(req.params.id, req.user.companyId);
    if (!m) throw new NotFoundError("Material");
    const result = await materialRepo.stockIn(req.params.id, {
      ...req.body,
      userId: req.user.userId,
    });
    if (["LOW", "CRITICAL", "OUT_OF_STOCK"].includes(result.material.status)) {
      notifyLowStock(
        result.material,
        result.material.status,
        req.user.companyId,
      ).catch(() => {});
    }
    res.json({ success: true, message: "Stocked in", data: result });
  }),
  stockOut: asyncHandler(async (req, res) => {
    const m = await materialRepo.findById(req.params.id, req.user.companyId);
    if (!m) throw new NotFoundError("Material");
    const result = await materialRepo.stockOut(req.params.id, {
      ...req.body,
      userId: req.user.userId,
    });
    if (
      result.statusChanged &&
      ["LOW", "CRITICAL", "OUT_OF_STOCK"].includes(result.material.status)
    ) {
      notifyLowStock(
        result.material,
        result.material.status,
        req.user.companyId,
      ).catch(() => {});
    }
    res.json({ success: true, message: "Issued out", data: result });
  }),
};

// ── EQUIPMENT ─────────────────────────────────────────────────
exports.equipment = {
  getAll: asyncHandler(async (req, res) => {
    const items = await equipmentRepo.findByCompany(
      req.user.companyId,
      req.query,
    );
    res.json({ success: true, data: items });
  }),
  getOne: asyncHandler(async (req, res) => {
    const item = await equipmentRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!item) throw new NotFoundError("Equipment");
    res.json({ success: true, data: item });
  }),
  create: asyncHandler(async (req, res) => {
    const item = await equipmentRepo.create({
      ...req.body,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: item });
  }),
  update: asyncHandler(async (req, res) => {
    const existing = await equipmentRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Equipment");
    const updated = await equipmentRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),
  delete: asyncHandler(async (req, res) => {
    const existing = await equipmentRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Equipment");
    await equipmentRepo.deleteById(req.params.id);
    res.json({ success: true });
  }),
  startUsage: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    if (eq.status !== "AVAILABLE")
      throw new AppError(`Equipment is ${eq.status.toLowerCase()}`, 400);
    const usage = await equipmentRepo.startUsage(req.params.id, {
      ...req.body,
      operatorId: req.user.userId,
    });
    res.status(201).json({ success: true, data: usage });
  }),
  endUsage: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    const result = await equipmentRepo.endUsage(
      req.body.usageId,
      req.params.id,
    );
    res.json({ success: true, data: result });
  }),
  logMaintenance: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    const { rows } = await query(
      "INSERT INTO maintenance_logs (equipment_id,type,description,cost,next_due_at,technician_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        req.params.id,
        req.body.type || "ROUTINE",
        req.body.description,
        req.body.cost || null,
        req.body.nextDueAt || null,
        req.body.technicianName || null,
      ],
    );
    await equipmentRepo.update(req.params.id, {
      status: req.body.completedNow ? "AVAILABLE" : "MAINTENANCE",
      next_maintenance_at: req.body.nextDueAt || null,
    });
    res.status(201).json({ success: true, data: rows[0] });
  }),
};

// ── BUDGETS ───────────────────────────────────────────────────
exports.budgets = {
  getSummary: asyncHandler(async (req, res) => {
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
  }),
  getAll: asyncHandler(async (req, res) => {
    const { rows } = await query(
      "SELECT * FROM budgets WHERE project_id=$1 ORDER BY category",
      [req.query.projectId],
    );
    res.json({ success: true, data: rows });
  }),
  create: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.body.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const b = await budgetRepo.create(req.body);
    res.status(201).json({ success: true, data: b });
  }),
  update: asyncHandler(async (req, res) => {
    const { rows } = await query(
      "UPDATE budgets SET allocated=$1,notes=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
      [req.body.allocated, req.body.notes || null, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
};

// ── EXPENSES ──────────────────────────────────────────────────
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

    const expense = await expenseRepo.approve(req.params.id, req.user.userId);

    if (expense.budget_id) {
      // Update by budget_id
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
      // Update by category + project
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

// ── VISITORS ──────────────────────────────────────────────────
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

// ── ATTENDANCE ────────────────────────────────────────────────
exports.attendance = {
  checkIn: asyncHandler(async (req, res) => {
    const existing = await attendanceRepo.findTodayByUser(
      req.user.userId,
      req.body.projectId,
    );
    if (existing)
      throw new AppError("Already checked in. Check out first.", 400);
    const record = await attendanceRepo.checkIn({
      ...req.body,
      userId: req.user.userId,
    });
    res.status(201).json({ success: true, data: record });
  }),
  checkOut: asyncHandler(async (req, res) => {
    const record = await attendanceRepo.checkOut(req.params.id);
    if (!record) throw new NotFoundError("Attendance record");
    res.json({ success: true, data: record });
  }),
  getAll: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.query.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const records = await attendanceRepo.findByProject(
      req.query.projectId,
      req.query.date,
    );
    res.json({ success: true, data: records });
  }),
};

// ── NOTIFICATIONS ─────────────────────────────────────────────
exports.notifications = {
  getAll: asyncHandler(async (req, res) => {
    const items = await notificationRepo.findByUser(req.user.userId);
    res.json({ success: true, data: items });
  }),
  readAll: asyncHandler(async (req, res) => {
    await notificationRepo.markAllRead(req.user.userId);
    res.json({ success: true });
  }),
  readOne: asyncHandler(async (req, res) => {
    await notificationRepo.markRead(req.params.id, req.user.userId);
    res.json({ success: true });
  }),
};

// ── USERS ─────────────────────────────────────────────────────
exports.users = {
  getAll: asyncHandler(async (req, res) => {
    const users = await userRepo.findByCompanyWithCount(req.user.companyId);
    res.json({ success: true, data: users });
  }),
  invite: asyncHandler(async (req, res) => {
    const company = await companyRepo.findById(req.user.companyId);
    const count = await userRepo.count({
      company_id: req.user.companyId,
      is_active: true,
    });
    if (count >= company.max_users)
      throw new PlanLimitError(
        `User limit reached (${company.max_users}). Upgrade plan.`,
      );
    const existing = await userRepo.findByEmail(req.body.email);
    if (existing) throw new ConflictError("Email already registered");
    const tempPass = Math.random().toString(36).slice(-10) + "A1!";
    const user = await userRepo.create({
      ...req.body,
      companyId: req.user.companyId,
      passwordHash: await bcrypt.hash(tempPass, 12),
    });
    // Send invite email
    const template = emailTemplates.inviteTeamMember(
      req.body.firstName || "Team Member",
      req.user.companyName || "your company",
      tempPass, 
      req.body.role,
    );
    sendEmail({
      to: req.body.email,
      subject: template.subject,
      html: template.html,
    }).catch(() => {});
    res.status(201).json({
      success: true,
      data: { id: user.id, email: user.email, tempPassword: tempPass },
    });
  }),
  update: asyncHandler(async (req, res) => {
    const updated = await userRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),
  toggleActive: asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.params.id, req.user.companyId);
    if (!user) throw new NotFoundError("User");
    if (user.id === req.user.userId)
      throw new AppError("Cannot deactivate own account", 400);
    const updated = await userRepo.update(req.params.id, {
      is_active: !user.is_active,
    });
    res.json({ success: true, data: updated });
  }),
};

// ── SYNC ──────────────────────────────────────────────────────
exports.sync = {
  pull: asyncHandler(async (req, res) => {
    const { deviceId } = req.query;
    const lastPulled = await syncRepo.getCursor(
      req.user.userId,
      deviceId || "default",
    );
    const changes = await syncRepo.getChangesSince(
      req.user.companyId,
      lastPulled,
    );
    await syncRepo.updateCursor(req.user.userId, deviceId || "default");
    res.json({
      success: true,
      data: {
        changes,
        pulledAt: new Date().toISOString(),
        lastPulled: lastPulled.toISOString(),
      },
    });
  }),
  push: asyncHandler(async (req, res) => {
    const { operations } = req.body;
    const results = [];
    for (const op of operations) {
      try {
        // Route operation to correct repo action
        let result;
        switch (`${op.entity}:${op.action}`) {
          case "materials:stockIn":
            result = await materialRepo.stockIn(op.id, {
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "materials:stockOut":
            result = await materialRepo.stockOut(op.id, {
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "visitors:create":
            result = await visitorRepo.create({
              ...op.payload,
              loggedById: req.user.userId,
            });
            break;
          case "visitors:checkout":
            result = await visitorRepo.checkout(op.id);
            break;
          case "attendance:checkIn":
            result = await attendanceRepo.checkIn({
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "attendance:checkOut":
            result = await attendanceRepo.checkOut(op.id);
            break;
          case "expenses:create":
            result = await expenseRepo.create({
              ...op.payload,
              submittedById: req.user.userId,
            });
            break;
          default:
            result = {
              skipped: true,
              reason: `Unknown operation: ${op.entity}:${op.action}`,
            };
        }
        results.push({ localId: op.localId, success: true, data: result });
      } catch (err) {
        results.push({
          localId: op.localId,
          success: false,
          error: err.message,
        });
      }
    }
    res.json({
      success: true,
      data: { results, processedAt: new Date().toISOString() },
    });
  }),
};

// ── AI ────────────────────────────────────────────────────────
exports.ai = {
  costPrediction: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.body.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const summary = await budgetRepo.getSummary(req.body.projectId);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `You are a Nigerian construction cost analyst. Analyze this project and respond ONLY with valid JSON.
Project: ${project.name} (${project.type}) — ${project.location}
Budget: ₦${summary.total_allocated?.toLocaleString("en-NG")} | Spent: ₦${summary.total_spent?.toLocaleString("en-NG")} (${summary.percent_used}%)
Categories: ${summary.by_category?.map((b) => `${b.category}: ${b.percent_used}% used`).join(", ")}
JSON schema: {"overallHealth":"GREEN|YELLOW|RED","healthSummary":"string","projectedFinalCost":number,"projectedOverrun":number,"riskFactors":["string"],"recommendations":["string"],"categoryInsights":[{"category":"string","status":"ON_TRACK|AT_RISK|OVERSPENT","insight":"string"}]}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const analysis = JSON.parse(resp.content[0].text.match(/\{[\s\S]*\}/)[0]);
    res.json({
      success: true,
      data: { project: { id: project.id, name: project.name }, analysis },
    });
  }),

  smartReorder: asyncHandler(async (req, res) => {
    const low = await materialRepo.getLowStock(req.user.companyId);
    if (!low.length)
      return res.json({
        success: true,
        data: { recommendations: [], message: "All stock levels healthy!" },
      });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Nigerian construction procurement specialist. Respond ONLY with valid JSON.
Low stock: ${low.map((m) => `${m.name}: ${m.quantity}${m.unit} (min:${m.min_quantity}, cost:₦${m.unit_cost})`).join("; ")}
JSON: {"recommendations":[{"materialName":"string","urgency":"IMMEDIATE|THIS_WEEK|NEXT_WEEK","suggestedQty":number,"estimatedCost":number,"reason":"string"}],"totalEstimatedCost":number,"summary":"string"}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const result = JSON.parse(resp.content[0].text.match(/\{[\s\S]*\}/)[0]);
    res.json({ success: true, data: result });
  }),

  siteSummary: asyncHandler(async (req, res) => {
    const { projectId } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ rows: visitors }, { rows: expenses }, { rows: stock }] =
      await Promise.all([
        query(
          "SELECT COUNT(*) AS cnt FROM visitors WHERE project_id=$1 AND time_in >= $2",
          [projectId, today],
        ),
        query(
          "SELECT SUM(amount)::numeric AS total FROM expenses WHERE project_id=$1 AND created_at >= $2",
          [projectId, today],
        ),
        query(
          "SELECT type, COUNT(*) AS cnt FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.company_id=$1 AND st.created_at >= $2 GROUP BY type",
          [req.user.companyId, today],
        ),
      ]);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Write a 3-paragraph daily site summary for a Nigerian construction project. Professional English. Under 200 words.
Visitors today: ${visitors[0]?.cnt || 0}
Expenses today: ₦${Number(expenses[0]?.total || 0).toLocaleString("en-NG")}
Stock movements: ${stock.map((s) => `${s.cnt} ${s.type}`).join(", ") || "none"}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    res.json({
      success: true,
      data: {
        summary: resp.content[0].text,
        generatedAt: new Date().toISOString(),
      },
    });
  }),
};

// ── REPORTS ───────────────────────────────────────────────────
const drawHeader = (doc, title, subtitle) => {
  doc.fillColor("#0A2342").rect(0, 0, doc.page.width, 80).fill();
  doc.fillColor("#FF6A00").rect(0, 76, doc.page.width, 4).fill();
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("PROJEX", 40, 20);
  doc
    .font("Helvetica")
    .fontSize(10)
    .text("Smart Construction Management", 40, 47);
  doc
    .fillColor("#0A2342")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(title, 40, 110);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#5D6D7E")
    .text(subtitle, 40, 130)
    .text(
      `Generated: ${new Date().toLocaleDateString("en-NG", { dateStyle: "long" })}`,
      40,
      146,
    );
  doc
    .strokeColor("#FF6A00")
    .lineWidth(1)
    .moveTo(40, 163)
    .lineTo(doc.page.width - 40, 163)
    .stroke();
  return 178;
};

const drawTable = (doc, headers, rows, startY) => {
  const cw = (doc.page.width - 80) / headers.length;
  let y = startY;
  doc
    .fillColor("#0A2342")
    .rect(40, y, doc.page.width - 80, 22)
    .fill();
  doc.fillColor("white").fontSize(9).font("Helvetica-Bold");
  headers.forEach((h, i) =>
    doc.text(h, 44 + i * cw, y + 6, { width: cw - 4, ellipsis: true }),
  );
  y += 22;
  rows.forEach((row, ri) => {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 60;
    }
    doc
      .fillColor(ri % 2 === 0 ? "#F4F6F7" : "white")
      .rect(40, y, doc.page.width - 80, 20)
      .fill();
    doc.fillColor("#0A2342").fontSize(8).font("Helvetica");
    row.forEach((cell, i) =>
      doc.text(String(cell ?? "-"), 44 + i * cw, y + 5, {
        width: cw - 4,
        ellipsis: true,
      }),
    );
    y += 20;
  });
  return y + 12;
};

exports.reports = {
  materialsPDF: asyncHandler(async (req, res) => {
    const { rows: txs } = await query(
      `SELECT st.*, m.name AS material_name, m.unit, u.first_name, u.last_name, p.name AS project_name
       FROM stock_transactions st JOIN materials m ON m.id=st.material_id
       JOIN users u ON u.id=st.user_id LEFT JOIN projects p ON p.id=st.project_id
       WHERE m.company_id=$1 ORDER BY st.created_at DESC LIMIT 500`,
      [req.user.companyId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=materials-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(
      doc,
      "Material Usage Report",
      `${txs.length} transactions`,
    );
    const headers = [
      "Date",
      "Material",
      "Type",
      "Qty",
      "Unit Cost (₦)",
      "Total (₦)",
      "Project",
      "By",
    ];
    const rows = txs.map((t) => [
      new Date(t.created_at).toLocaleDateString("en-NG"),
      t.material_name,
      t.type.replace("_", " "),
      `${t.quantity} ${t.unit}`,
      Number(t.unit_cost).toLocaleString("en-NG"),
      Number(t.total_cost).toLocaleString("en-NG"),
      t.project_name || "-",
      `${t.first_name} ${t.last_name[0]}.`,
    ]);
    drawTable(doc, headers, rows, y);
    doc.end();
  }),

  budgetPDF: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) throw new AppError("projectId required", 400);
    const project = await projectRepo.findById(projectId, req.user.companyId);
    if (!project) throw new NotFoundError("Project");
    const summary = await budgetRepo.getSummary(projectId);
    const { rows: expenses } = await query(
      "SELECT * FROM expenses WHERE project_id=$1 AND status='APPROVED' ORDER BY expense_date DESC",
      [projectId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=budget-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(doc, "Budget & Expense Report", project.name);
    doc
      .fillColor("#0A2342")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Budget Summary", 40, y);
    y += 16;
    const bHeaders = [
      "Category",
      "Allocated (₦)",
      "Spent (₦)",
      "Remaining (₦)",
      "% Used",
    ];
    const bRows = summary.by_category.map((b) => [
      b.category,
      Number(b.allocated).toLocaleString("en-NG"),
      Number(b.actual_spent).toLocaleString("en-NG"),
      Number(b.remaining).toLocaleString("en-NG"),
      `${b.percent_used}%`,
    ]);
    y = drawTable(doc, bHeaders, bRows, y);
    doc
      .fillColor("#0A2342")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Expense Transactions", 40, y + 8);
    y += 24;
    const eHeaders = [
      "Date",
      "Category",
      "Description",
      "Amount (₦)",
      "Status",
    ];
    const eRows = expenses
      .slice(0, 30)
      .map((e) => [
        new Date(e.expense_date).toLocaleDateString("en-NG"),
        e.category,
        e.description.slice(0, 35),
        Number(e.amount).toLocaleString("en-NG"),
        e.status,
      ]);
    drawTable(doc, eHeaders, eRows, y);
    doc.end();
  }),

  visitorsPDF: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) throw new AppError("projectId required", 400);
    const project = await projectRepo.findById(projectId, req.user.companyId);
    if (!project) throw new NotFoundError("Project");
    const { rows: visitors } = await query(
      "SELECT v.*, u.first_name, u.last_name FROM visitors v JOIN users u ON u.id=v.logged_by_id WHERE v.project_id=$1 ORDER BY v.time_in DESC LIMIT 200",
      [projectId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=visitors-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(doc, "Visitor Activity Report", project.name);
    const headers = [
      "Name",
      "Company",
      "Purpose",
      "Time In",
      "Time Out",
      "Duration",
      "Status",
    ];
    const rows = visitors.map((v) => [
      v.full_name,
      v.company || "-",
      v.purpose,
      new Date(v.time_in).toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      v.time_out
        ? new Date(v.time_out).toLocaleTimeString("en-NG", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "On Site",
      v.duration_mins
        ? `${Math.floor(v.duration_mins / 60)}h ${v.duration_mins % 60}m`
        : "-",
      v.status,
    ]);
    drawTable(doc, headers, rows, y);
    doc.end();
  }),

  materialsExcel: asyncHandler(async (req, res) => {
    const { rows: materials } = await query(
      "SELECT m.*, s.name AS supplier_name FROM materials m LEFT JOIN suppliers s ON s.id=m.supplier_id WHERE m.company_id=$1 ORDER BY m.name",
      [req.user.companyId],
    );
    const { rows: txs } = await query(
      "SELECT st.*, m.name AS material_name, m.unit FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.company_id=$1 ORDER BY st.created_at DESC LIMIT 1000",
      [req.user.companyId],
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        materials.map((m) => ({
          Name: m.name,
          Category: m.category,
          Unit: m.unit,
          Qty: Number(m.quantity),
          "Min Qty": Number(m.min_quantity),
          "Unit Cost (₦)": Number(m.unit_cost),
          "Total Value (₦)": Number(m.quantity) * Number(m.unit_cost),
          Status: m.status,
          Supplier: m.supplier_name || "-",
        })),
      ),
      "Materials",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        txs.map((t) => ({
          Date: new Date(t.created_at).toLocaleDateString("en-NG"),
          Material: t.material_name,
          Type: t.type,
          Quantity: Number(t.quantity),
          Unit: t.unit,
          "Unit Cost (₦)": Number(t.unit_cost),
          "Total (₦)": Number(t.total_cost),
        })),
      ),
      "Transactions",
    );
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=materials-${Date.now()}.xlsx`,
    );
    res.send(buf);
  }),
};

// ── EMPLOYEES ─────────────────────────────────────────────────
const { employeeRepo, billingRepo } = require("../repositories");
const { logger } = require("../utils/logger");

exports.employees = {
  getAll: asyncHandler(async (req, res) => {
    const employees = await employeeRepo.findByCompany(
      req.user.companyId,
      req.query,
    );
    res.json({ success: true, data: employees });
  }),
  getOne: asyncHandler(async (req, res) => {
    const emp = await employeeRepo.findById(req.params.id, req.user.companyId);
    if (!emp) throw new NotFoundError("Employee");
    res.json({ success: true, data: emp });
  }),
  create: asyncHandler(async (req, res) => {
    const emp = await employeeRepo.create({
      ...req.body,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: emp });
  }),
  update: asyncHandler(async (req, res) => {
    const existing = await employeeRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Employee");
    const updated = await employeeRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),
  setStatus: asyncHandler(async (req, res) => {
    const { status, terminationDate } = req.body;
    const updated = await employeeRepo.setStatus(
      req.params.id,
      status,
      terminationDate,
    );
    res.json({ success: true, data: updated });
  }),
  addDocument: asyncHandler(async (req, res) => {
    const doc = await employeeRepo.addDocument(req.params.id, req.body);
    res.status(201).json({ success: true, data: doc });
  }),
  getPayroll: asyncHandler(async (req, res) => {
    const {
      year = new Date().getFullYear(),
      month = new Date().getMonth() + 1,
    } = req.query;
    const rows = await employeeRepo.getPayrollSummary(
      req.user.companyId,
      parseInt(year),
      parseInt(month),
    );
    const total = rows.reduce((s, r) => s + parseFloat(r.total_pay || 0), 0);
    res.json({
      success: true,
      data: { employees: rows, total_payroll: total, year, month },
    });
  }),
};

// ── BILLING ───────────────────────────────────────────────────
const PLAN_PRICES = { STARTER: 5000, PRO: 15000, ENTERPRISE: 40000 };
const PLAN_LIMITS = {
  STARTER: { maxProjects: 2, maxUsers: 5 },
  PRO: { maxProjects: 10, maxUsers: 25 },
  ENTERPRISE: { maxProjects: 999, maxUsers: 999 },
};

exports.billing = {
  getSubscription: asyncHandler(async (req, res) => {
    const sub = await billingRepo.getSubscription(req.user.companyId);
    const company = await companyRepo.findById(req.user.companyId);
    res.json({ success: true, data: { subscription: sub, company } });
  }),

  initialize: asyncHandler(async (req, res) => {
    const { plan, email } = req.body;
    if (!PLAN_PRICES[plan]) throw new AppError("Invalid plan", 400);
    const amount = PLAN_PRICES[plan] * 100; // kobo
    const ref = `projex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let authUrl = `https://paystack.com/pay/projex-${plan.toLowerCase()}`;
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
              amount,
              reference: ref,
              currency: "NGN",
              metadata: { plan, companyId: req.user.companyId },
            }),
          },
        );
        const data = await r.json();
        if (data.status) authUrl = data.data.authorization_url;
      } catch (e) {
        logger.warn("Paystack init failed:", e.message);
      }
    }

    await billingRepo.createSubscription({
      companyId: req.user.companyId,
      plan,
      paystackRef: ref,
      amount: PLAN_PRICES[plan],
    });
    res.json({
      success: true,
      data: {
        authorizationUrl: authUrl,
        reference: ref,
        plan,
        amount: PLAN_PRICES[plan],
      },
    });
  }),

  verify: asyncHandler(async (req, res) => {
    const { reference } = req.body;
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
        logger.warn("Paystack verify failed:", e.message);
      }
    } else {
      verified = true; // dev mode - auto verify
    }

    if (!verified)
      throw new AppError("Payment not successful", 400, "PAYMENT_FAILED");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const sub = await billingRepo.activateSubscription(reference, {
      expiresAt,
      subCode: paystackData?.data?.subscription_code,
    });
    if (sub) {
      const limits = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.STARTER;
      await companyRepo.update(req.user.companyId, {
        plan: sub.plan,
        plan_expires_at: expiresAt,
        max_projects: limits.maxProjects,
        max_users: limits.maxUsers,
      });
      await billingRepo.recordPayment({
        companyId: req.user.companyId,
        subscriptionId: sub.id,
        paystackRef: reference,
        amount: sub.amount,
        status: "success",
        metadata: paystackData?.data,
      });
      // Send payment confirmation email
      try {
        const { rows: userRows } = await query(
          "SELECT u.first_name, u.email FROM users u WHERE u.company_id=$1 AND u.role IN ('SUPER_ADMIN','PROJECT_OWNER') ORDER BY u.created_at ASC LIMIT 1",
          [req.user.companyId],
        );
        if (userRows[0] && sub) {
          const template = emailTemplates.paymentConfirmation(
            userRows[0].first_name,
            sub.plan,
            sub.amount,
          );
          sendEmail({
            to: userRows[0].email,
            subject: template.subject,
            html: template.html,
          }).catch(() => {});
        }
      } catch (e) {
        logger.warn("Payment email failed:", e.message);
      }
    }
    res.json({ success: true, message: "Subscription activated", data: sub });
  }),

  webhook: asyncHandler(async (req, res) => {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
    if (secret) {
      const crypto = require("crypto");
      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (hash !== req.headers["x-paystack-signature"])
        return res.status(400).json({ success: false });
    }
    const { event, data } = req.body;
    if (event === "charge.success") {
      const ref = data.reference;
      const meta = data.metadata || {};
      if (meta.companyId && meta.plan) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await billingRepo
          .activateSubscription(ref, { expiresAt })
          .catch(() => {});
        const limits = PLAN_LIMITS[meta.plan] || PLAN_LIMITS.STARTER;
        await companyRepo
          .update(meta.companyId, {
            plan: meta.plan,
            plan_expires_at: expiresAt,
            ...limits,
          })
          .catch(() => {});
      }
    }
    res.json({ success: true });
  }),

  getHistory: asyncHandler(async (req, res) => {
    const history = await billingRepo.getPaymentHistory(req.user.companyId);
    res.json({ success: true, data: history });
  }),
};
