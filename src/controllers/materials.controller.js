const { asyncHandler } = require("../middleware");
const { materialRepo } = require("../repositories");
const { NotFoundError } = require("../utils/errors");
const { notifyLowStock } = require("../services");

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
    const { id } = req.params;
    const { companyId } = req.user;

    console.log("[getOne] id:", id, "companyId:", companyId);

    const m = await materialRepo.findByIdWithLedger(id, companyId);

    console.log("[getOne] found:", !!m);

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

  getProjectMaterials: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, message: "projectId is required" });
    }
    const data = await materialRepo.getProjectMaterials(
      projectId,
      req.user.companyId,
    );
    res.json({ success: true, data });
  }),

  createFromResource: asyncHandler(async (req, res) => {
    const {
      resourceId,
      projectId,
      name,
      unit,
      unitCost,
      category,
      description,
    } = req.body;
    if (!resourceId)
      return res
        .status(400)
        .json({ success: false, message: "resourceId is required" });
    const material = await materialRepo.createFromResource(
      resourceId,
      projectId,
      req.user.companyId,
      { name, unit, unitCost, category, description },
    );
    res.status(201).json({ success: true, data: material });
  }),
  getHistory: asyncHandler(async (req, res) => {
    const { projectId, materialId, type, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const rows = await materialRepo.getStockHistory(req.user.companyId, {
      projectId,
      materialId,
      type,
      limit: parseInt(limit),
      offset,
    });
    res.json({
      success: true,
      data: rows,
      meta: { page: parseInt(page), limit: parseInt(limit) },
    });
  }),
};
