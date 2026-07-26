// backend/src/controllers/equipment.controller.js
const { asyncHandler } = require("../middleware");
const { equipmentRepo } = require("../repositories");
const { NotFoundError, AppError } = require("../utils/errors");

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
      actorId: req.user.userId,
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

  // ── Owned: usage timer ──────────────────────────────────────────────
  startUsage: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    if (eq.ownership_type === "HIRED")
      throw new AppError("Hired equipment does not use the usage timer", 400);
    if (eq.status !== "AVAILABLE")
      throw new AppError(
        `Equipment is currently ${eq.status.toLowerCase()}`,
        400,
      );

    const usage = await equipmentRepo.startUsage(req.params.id, {
      projectId: req.body.projectId || null,
      operatorId: req.user.userId,
      notes: req.body.notes || null,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: usage });
  }),

  endUsage: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");

    // If equipment isn't IN_USE in DB, just return success (stale state)
    if (eq.status !== "IN_USE") {
      return res.json({
        success: true,
        data: { already_ended: true, message: "Equipment was not in use" },
      });
    }

    try {
      const result = await equipmentRepo.endUsage(
        req.body.usageId,
        req.params.id,
        { companyId: req.user.companyId },
      );
      res.json({ success: true, data: result });
    } catch (err) {
      // No usage row found — equipment is stuck IN_USE, force reset it
      await equipmentRepo.update(req.params.id, { status: "AVAILABLE" });
      res.json({
        success: true,
        data: {
          already_ended: true,
          duration_hrs: 0,
          total_cost: 0,
          formatted_duration: "0h",
          message: "Usage record not found — equipment reset to available",
        },
      });
    }
  }),

  // ── Hired: return ───────────────────────────────────────────────────
  returnHire: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    if (eq.ownership_type !== "HIRED")
      throw new AppError("Only hired equipment can be returned", 400);
    if (eq.status === "RETURNED")
      throw new AppError("Equipment already returned", 400);

    const result = await equipmentRepo.returnHire(req.params.id, {
      actorId: req.user.userId,
      notes: req.body.notes || null,
      companyId: req.user.companyId,
      projectId: req.body.projectId || null,
    });
    res.json({ success: true, data: result });
  }),

  // ── Maintenance ─────────────────────────────────────────────────────
  logMaintenance: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");

    const result = await equipmentRepo.logMaintenance(req.params.id, {
      description: req.body.description,
      cost: req.body.cost ? Number(req.body.cost) : null,
      technicianName: req.body.technicianName || null,
      nextDueAt: req.body.nextDueAt || null,
      completedNow: req.body.completedNow !== false,
      actorId: req.user.userId,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: result });
  }),

  // ── Activity history ────────────────────────────────────────────────
  getActivity: asyncHandler(async (req, res) => {
    const rows = await equipmentRepo.getActivity(
      req.params.id,
      req.user.companyId,
      { limit: Number(req.query.limit) || 50 },
    );
    res.json({ success: true, data: rows });
  }),

  getAllActivity: asyncHandler(async (req, res) => {
    const rows = await equipmentRepo.getCompanyActivity(req.user.companyId, {
      limit: Number(req.query.limit) || 100,
      equipmentId: req.query.equipmentId,
    });
    res.json({ success: true, data: rows });
  }),

  // POST /equipment/:id/rehire
  reHire: asyncHandler(async (req, res) => {
    const eq = await equipmentRepo.findById(req.params.id, req.user.companyId);
    if (!eq) throw new NotFoundError("Equipment");
    if (eq.status !== "RETURNED")
      throw new AppError("Only returned equipment can be re-hired", 400);
    const result = await equipmentRepo.reHire(req.params.id, {
      hireCompany: req.body.hireCompany || null,
      hireRate: req.body.hireRate ? Number(req.body.hireRate) : null,
      hireRateUnit: req.body.hireRateUnit || null,
      hireStartDate: req.body.hireStartDate,
      hireEndDate: req.body.hireEndDate || null,
      actorId: req.user.userId,
      companyId: req.user.companyId,
      projectId: req.body.projectId || null,
    });
    res.json({ success: true, data: result });
  }),

  // GET /equipment/schedule-resources?projectId=<uuid>
  getScheduleResources: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) throw new AppError("projectId is required", 400);
    const rows = await equipmentRepo.getScheduleResources(
      projectId,
      req.user.companyId,
    );
    res.json({ success: true, data: rows });
  }),
};
