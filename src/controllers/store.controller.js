// backend/src/controllers/store.controller.js
"use strict";

const repo = require("../repositories/store.repository");
const { asyncHandler } = require("../middleware");
const { NotFoundError, AppError } = require("../utils/errors");
const cloudinary = require("../services/cloudinary.service");
const crypto = require("crypto");
const multer = require("multer");

// ── Receipt upload (Cloudinary) ───────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadReceipt = async (buffer, mimeType, companyId) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `projex/${companyId}/receipts`;
  const paramString = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha256")
    .update(paramString + process.env.CLOUDINARY_API_SECRET)
    .digest("hex");

  const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const body = new URLSearchParams({
    file: base64,
    folder,
    timestamp: String(timestamp),
    api_key: process.env.CLOUDINARY_API_KEY,
    signature,
  });

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) throw new Error("Receipt upload failed");
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
};

// ── Resource Catalog ────────────────────────────────────────────────────────

exports.getCatalog = asyncHandler(async (req, res) => {
  const { type, search } = req.query;
  const items = await repo.getCatalog(req.user.companyId, { type, search });
  res.json({ success: true, data: items });
});

exports.createCatalogItem = asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (!["LABOUR", "MATERIAL", "EQUIPMENT", "SUBCONTRACT"].includes(type)) {
    throw new AppError(
      "type must be LABOUR, MATERIAL, EQUIPMENT, or SUBCONTRACT",
      400,
    );
  }
  const item = await repo.createCatalogItem(req.user.companyId, req.body);
  res.status(201).json({ success: true, data: item });
});

exports.updateCatalogItem = asyncHandler(async (req, res) => {
  const item = await repo.updateCatalogItem(
    req.params.catalogItemId,
    req.user.companyId,
    req.body,
  );
  if (!item) throw new NotFoundError("Catalog item");
  res.json({ success: true, data: item });
});

exports.deleteCatalogItem = asyncHandler(async (req, res) => {
  await repo.deleteCatalogItem(req.params.catalogItemId, req.user.companyId);
  res.json({ success: true });
});

// ── Project Store ─────────────────────────────────────────────────────────────

exports.getStore = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const [items, summary] = await Promise.all([
    repo.getStore(projectId),
    repo.getStoreSummary(projectId),
  ]);
  res.json({ success: true, data: { items, summary } });
});

exports.getStoreItem = asyncHandler(async (req, res) => {
  const { projectId, itemId } = req.params;
  const [item, history] = await Promise.all([
    repo.getStoreItem(itemId, projectId),
    repo.getStoreHistory(itemId),
  ]);
  if (!item) throw new NotFoundError("Store item");
  res.json({ success: true, data: { item, history } });
});

exports.createStoreItem = asyncHandler(async (req, res) => {
  // req.body may include an optional taskResourceId, which repo.createStoreItem
  // uses to link this new item straight to a schedule resource (real FK,
  // replacing the old name-matching approach).
  const item = await repo.createStoreItem(
    req.params.projectId,
    req.user.companyId,
    req.body,
  );
  res.status(201).json({ success: true, data: item });
});

exports.updateStoreItem = asyncHandler(async (req, res) => {
  const item = await repo.updateStoreItem(
    req.params.itemId,
    req.params.projectId,
    req.body,
  );
  if (!item) throw new NotFoundError("Store item");
  res.json({ success: true, data: item });
});

// ── Task resource linking ─────────────────────────────────────────────────────

// GET /:projectId/store/unlinked-resources?search=...
// Backs the "select a task to add this item to" picker: returns MATERIAL
// resources for the project that don't yet have a store item attached.
exports.getUnlinkedResources = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { search } = req.query;
  const resources = await repo.getUnlinkedMaterialResources(projectId, search);
  res.json({ success: true, data: resources });
});

// PATCH /:projectId/store/:itemId/link-resource
// Links an EXISTING store item to a resource after the fact (as opposed to
// linking at creation time via createStoreItem's taskResourceId).
exports.linkResource = asyncHandler(async (req, res) => {
  const { projectId, itemId } = req.params;
  const { taskResourceId } = req.body;
  if (!taskResourceId) throw new AppError("taskResourceId is required", 400);
  const resource = await repo.linkStoreItemToResource(
    itemId,
    taskResourceId,
    projectId,
  );
  res.json({ success: true, data: resource });
});

// ── Stock In ──────────────────────────────────────────────────────────────────

exports.stockIn = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { projectId, itemId } = req.params;
    const userId = req.user.id || req.user.userId;
    const companyId = req.user.companyId;
    const data = { ...req.body };

    // Upload receipt if provided
    if (req.file) {
      const { url, publicId } = await uploadReceipt(
        req.file.buffer,
        req.file.mimetype,
        companyId,
      );
      data.receiptUrl = url;
      data.receiptPublicId = publicId;
    }

    const result = await repo.recordStockIn(
      itemId,
      projectId,
      companyId,
      userId,
      data,
    );
    res.status(201).json({ success: true, data: result });
  }),
];

exports.stockOut = asyncHandler(async (req, res) => {
  const { projectId, itemId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.recordStockOut(itemId, projectId, userId, req.body);
  res.status(201).json({ success: true, data: result });
});

exports.approveStockIn = asyncHandler(async (req, res) => {
  const { projectId, stockInId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.approveStockIn(stockInId, projectId, userId);
  if (!result) throw new NotFoundError("Stock-in record");
  res.json({ success: true, data: result });
});

exports.rejectStockIn = asyncHandler(async (req, res) => {
  const { projectId, stockInId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.rejectStockIn(
    stockInId,
    projectId,
    userId,
    req.body?.reason,
  );
  if (!result) throw new NotFoundError("Stock-in record");
  res.json({ success: true, data: result });
});

// PATCH /:itemId/stock-in/:stockInId/receipt — attach or replace a receipt
// on an existing stock-in record. Blocked on REJECTED records at the repo
// layer (WHERE status != 'REJECTED'); a null result here means either the
// record doesn't exist or it's rejected — both surface as the same
// message since the reason usually isn't the point when someone hits this.
exports.attachStockInReceipt = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { projectId, stockInId } = req.params;
    const companyId = req.user.companyId;

    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "A receipt file is required" });

    const { url, publicId } = await uploadReceipt(
      req.file.buffer,
      req.file.mimetype,
      companyId,
    );

    const result = await repo.attachStockInReceipt(
      stockInId,
      projectId,
      url,
      publicId,
    );
    if (!result)
      return res.status(400).json({
        success: false,
        message:
          "Could not attach receipt — record not found or already rejected.",
      });
    res.json({ success: true, data: result });
  }),
];

// Returns a flat, chronologically-sorted array of { direction, quantity,
// unit_price, total_cost, label, created_at } — repo.getStoreHistory does
// the merge+sort in SQL. (Previously this called getStockInHistory +
// getStockOutHistory separately and returned { stockIn, stockOut } unmerged,
// which crashed the frontend's history.map().)
exports.getHistory = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const history = await repo.getStoreHistory(itemId);
  res.json({ success: true, data: history });
});

// ── Requests ──────────────────────────────────────────────────────────────────

exports.getRequests = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { status, taskId } = req.query;
  const requests = await repo.getRequests(projectId, { status, taskId });
  res.json({ success: true, data: requests });
});

exports.createRequest = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.id || req.user.userId;
  const companyId = req.user.companyId;

  const { storeItemId, quantityRequested } = req.body;
  if (!storeItemId) {
    throw new AppError("storeItemId is required", 400);
  }
  if (
    quantityRequested == null ||
    isNaN(Number(quantityRequested)) ||
    Number(quantityRequested) <= 0
  ) {
    throw new AppError("A valid quantityRequested is required", 400);
  }

  let result;
  try {
    result = await repo.createRequest(projectId, companyId, userId, req.body);
  } catch (e) {
    if (e.code === "INSUFFICIENT_STOCK") {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message: e.message,
        availableQty: e.availableQty,
        unit: e.unit,
      });
    }
    // Log the full payload alongside the raw DB error — the "Required
    // field missing" summary that reaches the app logs strips out which
    // column actually failed. This puts it back, without needing another
    // round of guessing from a one-line warn log.
    console.error(
      "createRequest failed. Payload:",
      JSON.stringify(req.body),
      "DB error:",
      e.message,
    );
    throw e;
  }

  res.status(201).json({ success: true, data: result.request });
});

exports.approveRequest = asyncHandler(async (req, res) => {
  const { projectId, requestId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.approveRequest(
    requestId,
    projectId,
    userId,
    req.body,
  );
  res.json({ success: true, data: result });
});

exports.rejectRequest = asyncHandler(async (req, res) => {
  const { projectId, requestId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.rejectRequest(
    requestId,
    projectId,
    userId,
    req.body.reason,
  );
  res.json({ success: true, data: result });
});

// ── Wastage ───────────────────────────────────────────────────────────────────

exports.recordWastage = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.id || req.user.userId;
  const result = await repo.recordWastage(projectId, userId, req.body);
  res.status(201).json({ success: true, data: result });
});

exports.getWastage = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { taskId } = req.query;
  const result = await repo.getWastage(projectId, { taskId });
  res.json({ success: true, data: result });
});

exports.updateWastage = asyncHandler(async (req, res) => {
  const { projectId, wastageId } = req.params;
  const result = await repo.updateWastage(wastageId, projectId, req.body);
  if (!result) throw new NotFoundError("Wastage record");
  res.json({ success: true, data: result });
});

exports.getExcessMaterials = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { taskId } = req.query;
  const result = await repo.getExcessMaterials(projectId, { taskId });
  res.json({ success: true, data: result });
});
