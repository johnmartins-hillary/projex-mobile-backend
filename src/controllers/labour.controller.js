// backend/src/controllers/labour.controller.js
const LabourRepository = require("../repositories/labour.repository");
const { asyncHandler } = require("../middleware");
const crypto = require("crypto");
const multer = require("multer");

const repo = new LabourRepository();

// ── Receipt upload (Cloudinary) — mirrors store.controller.js's helper
// exactly, since that one isn't exported/shared as a util. ──────────────

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

// GET /projects/:projectId/labour/schedule
// Returns LABOUR resources from the schedule as the plan
exports.getScheduleLabour = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const companyId = req.user.companyId;
  if (!companyId)
    return res
      .status(400)
      .json({ success: false, message: "Company not found on user" });
  const data = await repo.getScheduleLabour(projectId, companyId);
  res.json({ success: true, data });
});

// GET /projects/:projectId/labour/logs
// Returns daily log entries with optional filters
exports.getLogs = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { startDate, endDate, trade, phaseId } = req.query;
  const data = await repo.getLogs(projectId, {
    startDate,
    endDate,
    trade,
    phaseId,
  });
  res.json({ success: true, data });
});

// GET /projects/:projectId/labour/summary
// Returns planned vs actual per trade + daily chart data
exports.getSummary = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const companyId = req.user.companyId;
  const data = await repo.getSummary(projectId, companyId);
  res.json({ success: true, data });
});

// POST /projects/:projectId/labour/logs
// Receipt is optional — sent as multipart/form-data when present, so this
// always runs through multer (which passes through fine with no file).
exports.createLog = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    const {
      trade,
      headcount,
      dayRate,
      logDate,
      phaseId,
      taskId,
      taskResourceId,
      notes,
      excessAmount,
      excessReason,
    } = req.body;

    if (!trade?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Trade is required" });
    if (!headcount || headcount < 1)
      return res
        .status(400)
        .json({ success: false, message: "Headcount must be at least 1" });
    if (!dayRate || dayRate < 0)
      return res
        .status(400)
        .json({ success: false, message: "Day rate is required" });

    let receiptUrl = null;
    let receiptPublicId = null;
    if (req.file) {
      const uploaded = await uploadReceipt(
        req.file.buffer,
        req.file.mimetype,
        companyId,
      );
      receiptUrl = uploaded.url;
      receiptPublicId = uploaded.publicId;
    }

    const log = await repo.createLog(projectId, companyId, userId, {
      trade,
      headcount: Number(headcount),
      dayRate: Number(dayRate),
      logDate,
      phaseId,
      taskId,
      taskResourceId,
      notes,
      receiptUrl,
      receiptPublicId,
      excessAmount: excessAmount ? Number(excessAmount) : 0,
      excessReason,
    });
    res.status(201).json({ success: true, data: log });
  }),
];

// PUT /projects/:projectId/labour/logs/:logId
exports.updateLog = [
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const { projectId, logId } = req.params;
    const companyId = req.user.companyId;
    const {
      trade,
      headcount,
      day_rate,
      log_date,
      phase_id,
      task_id,
      task_resource_id,
      notes,
      excess_amount,
      excess_reason,
    } = req.body;

    const updateData = {
      trade,
      headcount,
      day_rate,
      log_date,
      phase_id,
      task_id,
      task_resource_id,
      notes,
      excess_amount,
      excess_reason,
    };

    if (req.file) {
      const uploaded = await uploadReceipt(
        req.file.buffer,
        req.file.mimetype,
        companyId,
      );
      updateData.receipt_url = uploaded.url;
      updateData.receipt_public_id = uploaded.publicId;
    }

    const log = await repo.updateLog(logId, projectId, updateData);
    if (!log)
      return res.status(404).json({ success: false, message: "Log not found" });
    res.json({ success: true, data: log });
  }),
];

// DELETE /projects/:projectId/labour/logs/:logId
exports.deleteLog = asyncHandler(async (req, res) => {
  const { projectId, logId } = req.params;
  const log = await repo.deleteLog(logId, projectId);
  if (!log)
    return res.status(404).json({ success: false, message: "Log not found" });
  res.json({ success: true, message: "Log deleted" });
});

// PATCH /projects/:projectId/labour/logs/:logId/approve
// Owner-tier only — enforce via route middleware (the labour routes file
// hasn't been shared, so this needs an ownerOnly-equivalent middleware
// added at the route level, mirroring store.routes.js's ownerOnly alias).
exports.approveLog = asyncHandler(async (req, res) => {
  const { projectId, logId } = req.params;
  const userId = req.user.id || req.user.userId;
  const log = await repo.approveLog(logId, projectId, userId);
  if (!log)
    return res.status(404).json({ success: false, message: "Log not found" });
  res.json({ success: true, data: log });
});

// PATCH /projects/:projectId/labour/logs/:logId/reject
exports.rejectLog = asyncHandler(async (req, res) => {
  const { projectId, logId } = req.params;
  const userId = req.user.id || req.user.userId;
  const log = await repo.rejectLog(logId, projectId, userId, req.body?.reason);
  if (!log)
    return res.status(404).json({ success: false, message: "Log not found" });
  res.json({ success: true, data: log });
});
