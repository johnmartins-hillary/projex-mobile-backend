// backend/src/controllers/paymentRequests.controller.js
const PaymentRequestsRepository = require("../repositories/paymentRequests.repository");
const { asyncHandler } = require("../middleware");
const crypto = require("crypto");
const multer = require("multer");

const repo = new PaymentRequestsRepository();

// ── Receipt upload (Cloudinary) — same pattern as store/labour/
// subcontracts controllers (not shared as a util anywhere in this
// codebase yet). Only used here for confirm() now — request creation
// itself never takes a receipt, since nothing's been approved yet. ──────

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

// GET /payment-requests?projectId=&status=PENDING|APPROVED|REJECTED|COMPLETED&type=STOCK_IN|LABOUR|SUBCONTRACT
exports.getPendingRequests = asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const { projectId, status, type } = req.query;
  const data = await repo.getRequests(companyId, {
    projectId,
    type,
    status: status || "PENDING",
  });
  res.json({ success: true, data });
});

// POST /payment-requests
// body: { type: 'STOCK_IN'|'LABOUR'|'SUBCONTRACT', projectId, payload, notes }
// `payload` shape depends on type — see paymentRequests.repository.js's
// confirm() for exactly which fields each type reads back out of it.
exports.create = asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id || req.user.userId;
  const { type, projectId, payload, notes } = req.body;

  if (!["STOCK_IN", "LABOUR", "SUBCONTRACT"].includes(type)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid request type" });
  }
  if (!projectId)
    return res
      .status(400)
      .json({ success: false, message: "projectId is required" });
  if (!payload || typeof payload !== "object") {
    return res
      .status(400)
      .json({ success: false, message: "payload is required" });
  }

  const result = await repo.create(
    type,
    projectId,
    companyId,
    userId,
    payload,
    notes,
  );
  res.status(201).json({ success: true, data: result });
});

// PATCH /payment-requests/:id/approve
// body: { projectId }
exports.approve = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { projectId } = req.body;
  const userId = req.user.id || req.user.userId;
  if (!projectId)
    return res
      .status(400)
      .json({ success: false, message: "projectId is required" });
  const result = await repo.approve(id, projectId, userId);
  if (!result)
    return res.status(404).json({
      success: false,
      message: "Request not found or no longer pending",
    });
  res.json({ success: true, data: result });
});

// PATCH /payment-requests/:id/reject
// body: { projectId, reason }
exports.reject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { projectId, reason } = req.body;
  const userId = req.user.id || req.user.userId;
  if (!projectId)
    return res
      .status(400)
      .json({ success: false, message: "projectId is required" });
  const result = await repo.reject(id, projectId, userId, reason);
  if (!result)
    return res.status(404).json({
      success: false,
      message: "Request not found or no longer pending",
    });
  res.json({ success: true, data: result });
});

// PATCH /payment-requests/:id/confirm
// multipart/form-data: { projectId, receipt: <file> }
// The one-tap action — only works on an APPROVED request. Creates the
// real stock-in/labour-log/subcontract-payment record and attaches the
// receipt in the same step.
exports.confirm = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { projectId } = req.body;
    const userId = req.user.id || req.user.userId;
    const companyId = req.user.companyId;

    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "projectId is required" });
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "A receipt file is required" });

    const { url, publicId } = await uploadReceipt(
      req.file.buffer,
      req.file.mimetype,
      companyId,
    );

    try {
      const result = await repo.confirm(id, projectId, userId, url, publicId);
      if (!result)
        return res
          .status(404)
          .json({ success: false, message: "Request not found" });
      res.json({ success: true, data: result });
    } catch (e) {
      if (e.code === "INVALID_STATE") {
        return res.status(400).json({ success: false, message: e.message });
      }
      throw e;
    }
  }),
];
