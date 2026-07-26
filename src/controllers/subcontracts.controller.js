// backend/src/controllers/subcontracts.controller.js
const SubcontractsRepository = require("../repositories/subcontracts.repository");
const { asyncHandler } = require("../middleware");
const crypto = require("crypto");
const multer = require("multer");

const repo = new SubcontractsRepository();

// ── Receipt upload (Cloudinary) — mirrors store.controller.js's and
// labour.controller.js's helper exactly, since it isn't shared as a util
// anywhere in this codebase yet. ─────────────────────────────────────────

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

exports.getSchedule = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const companyId = req.user.companyId;
  const data = await repo.getScheduleSubcontracts(projectId, companyId);
  res.json({ success: true, data });
});

exports.getAll = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const companyId = req.user.companyId;
  const data = await repo.getAll(projectId, companyId);
  res.json({ success: true, data });
});

exports.create = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const companyId = req.user.companyId;
  const { companyName, scope } = req.body;
  if (!companyName?.trim())
    return res
      .status(400)
      .json({ success: false, message: "Company name is required" });
  if (!scope?.trim())
    return res
      .status(400)
      .json({ success: false, message: "Scope is required" });
  const sub = await repo.create(projectId, companyId, req.body);
  res.status(201).json({ success: true, data: sub });
});

exports.getMilestones = asyncHandler(async (req, res) => {
  const { subId } = req.params;
  const data = await repo.getMilestones(subId);
  res.json({ success: true, data });
});

exports.createMilestone = asyncHandler(async (req, res) => {
  const { subId } = req.params;
  const { title, amount } = req.body;
  if (!title?.trim())
    return res
      .status(400)
      .json({ success: false, message: "Title is required" });
  if (!amount)
    return res
      .status(400)
      .json({ success: false, message: "Amount is required" });
  const m = await repo.createMilestone(subId, req.body);
  res.status(201).json({ success: true, data: m });
});

exports.updateMilestone = asyncHandler(async (req, res) => {
  const { subId, milestoneId } = req.params;
  const m = await repo.updateMilestone(subId, milestoneId, req.body);
  if (!m)
    return res
      .status(404)
      .json({ success: false, message: "Milestone not found" });
  res.json({ success: true, data: m });
});

exports.getPayments = asyncHandler(async (req, res) => {
  const { subId } = req.params;
  const data = await repo.getPayments(subId);
  res.json({ success: true, data });
});

// Receipt is optional — sent as multipart/form-data when present, so this
// always runs through multer (passes through fine with no file attached,
// same pattern as labour.controller.js's createLog/updateLog).
exports.createPayment = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { subId } = req.params;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    if (!req.body.amount)
      return res
        .status(400)
        .json({ success: false, message: "Amount is required" });

    const data = { ...req.body };
    if (req.file) {
      const uploaded = await uploadReceipt(
        req.file.buffer,
        req.file.mimetype,
        companyId,
      );
      data.receiptUrl = uploaded.url;
      data.receiptPublicId = uploaded.publicId;
    }

    const payment = await repo.createPayment(subId, userId, data);
    res.status(201).json({ success: true, data: payment });
  }),
];

exports.releaseRetention = asyncHandler(async (req, res) => {
  const { subId } = req.params;
  const sub = await repo.releaseRetention(subId);
  if (!sub)
    return res
      .status(404)
      .json({ success: false, message: "Subcontract not found" });
  res.json({ success: true, data: sub });
});

// PATCH /:subId/payments/:paymentId/receipt — attach/replace a receipt on
// an existing payment. Blocked at the repo layer once REJECTED.
exports.attachPaymentReceipt = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { projectId, paymentId } = req.params;
    const companyId = req.user.companyId;

    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "A receipt file is required" });

    const uploaded = await uploadReceipt(
      req.file.buffer,
      req.file.mimetype,
      companyId,
    );

    const result = await repo.attachPaymentReceipt(
      paymentId,
      projectId,
      uploaded.url,
      uploaded.publicId,
    );
    if (!result)
      return res.status(400).json({
        success: false,
        message:
          "Could not attach receipt — payment not found or already rejected.",
      });
    res.json({ success: true, data: result });
  }),
];
