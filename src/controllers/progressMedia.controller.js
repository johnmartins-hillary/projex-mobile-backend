// backend/src/controllers/progressMedia.controller.js
const crypto = require("crypto");
const FormData = require("form-data");
const ProgressMediaRepository = require("../repositories/progressMedia.repository");
const { asyncHandler } = require("../middleware");
const { deleteAsset } = require("../services/cloudinary.service");
const { logger } = require("../utils/logger");

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

const repo = new ProgressMediaRepository();

// ── Upload buffer → Cloudinary via signed multipart POST ─────────────────────
// Uses form-data (node) + native fetch — no base64, no SDK
// This handles large files without memory issues

async function uploadToCloudinary(
  buffer,
  filename,
  mimeType,
  folder,
  resourceType,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramString = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha256")
    .update(paramString + CLOUDINARY_API_SECRET)
    .digest("hex");

  const form = new FormData();
  form.append("file", buffer, { filename, contentType: mimeType });
  form.append("folder", folder);
  form.append("timestamp", String(timestamp));
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    { method: "POST", body: form, headers: form.getHeaders() },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      err.error?.message || `Cloudinary ${resourceType} upload failed`,
    );
  }

  return res.json(); // { secure_url, public_id, duration, bytes, ... }
}

// ── GET /progress-photos/timeline ────────────────────────────────────────────

exports.getTimeline = asyncHandler(async (req, res) => {
  const { projectId, dateFrom, dateTo } = req.query;
  const data = await repo.getTimeline(
    req.user.companyId,
    projectId,
    dateFrom,
    dateTo,
  );
  res.json({ success: true, data });
});

// ── GET /progress-photos ──────────────────────────────────────────────────────

exports.getAll = asyncHandler(async (req, res) => {
  const { projectId, category, mediaType, limit } = req.query;
  const data = await repo.getAll(req.user.companyId, {
    projectId,
    category,
    mediaType,
    limit,
  });
  res.json({ success: true, data });
});

// ── POST /progress-photos ─────────────────────────────────────────────────────

exports.create = asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id || req.user.userId;

  // Debug log — remove after fixing
  logger.info("progress-photos POST body:", JSON.stringify(req.body));
  logger.info(
    "progress-photos POST file:",
    req.file
      ? `name=${req.file.originalname} size=${req.file.size} mime=${req.file.mimetype}`
      : "NO FILE",
  );
  logger.info("progress-photos Content-Type:", req.headers["content-type"]);

  const {
    projectId,
    title,
    description,
    location,
    takenAt,
    category,
    isMilestone,
    photoUrl,
  } = req.body;

  if (!projectId || !title) {
    logger.warn(
      `progress-photos missing fields — projectId=${projectId} title=${title}`,
    );
    return res.status(400).json({
      success: false,
      message: `Missing required fields — projectId: ${projectId || "MISSING"}, title: ${title || "MISSING"}`,
    });
  }

  let mediaUrl = photoUrl || null;
  let publicId = null;
  let duration = null;
  let mediaType = req.body.mediaType || "photo";

  if (req.file) {
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "File is empty — upload failed on device",
        });
    }

    const isVideo = req.file.mimetype.startsWith("video/");
    mediaType = isVideo ? "video" : "photo";
    const resourceType = isVideo ? "video" : "image";
    const folder = `projex/${companyId}/progress`;

    logger.info(
      `Uploading ${mediaType} to Cloudinary — ${(req.file.size / 1024).toFixed(0)} KB`,
    );

    const result = await uploadToCloudinary(
      req.file.buffer,
      req.file.originalname || (isVideo ? "upload.mp4" : "upload.jpg"),
      req.file.mimetype,
      folder,
      resourceType,
    );

    mediaUrl = result.secure_url;
    publicId = result.public_id;
    duration = result.duration ? Math.round(result.duration) : null;

    logger.info(`Cloudinary upload OK: ${publicId}`);
  }

  if (!mediaUrl) {
    return res
      .status(400)
      .json({ success: false, message: "No file or photoUrl provided" });
  }

  const record = await repo.create({
    projectId,
    companyId,
    userId,
    title,
    description,
    location,
    takenAt,
    category,
    isMilestone: isMilestone === "true" || isMilestone === true,
    mediaUrl,
    mediaType,
    publicId,
    duration,
    photoUrl: mediaUrl,
  });

  res.status(201).json({ success: true, data: record });
});

// ── DELETE /progress-photos/:id ───────────────────────────────────────────────

exports.bulkCreate = asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id || req.user.userId;
  const { records } = req.body;
  // records: [{ projectId, title, description, location, category,
  //             takenAt, isMilestone, mediaUrl, mediaType, publicId, duration }]

  if (!Array.isArray(records) || records.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "records array required" });
  }

  // Validate each record has required fields
  for (const [i, r] of records.entries()) {
    if (!r.projectId || !r.title || !r.mediaUrl) {
      return res.status(400).json({
        success: false,
        message: `Record ${i} missing projectId, title or mediaUrl`,
      });
    }
  }

  const enriched = records.map((r) => ({
    ...r,
    companyId,
    takenById: userId,
    isMilestone: r.isMilestone === true || r.isMilestone === "true",
  }));

  const rows = await repo.bulkCreate(enriched);
  res.status(201).json({ success: true, data: rows });
});

exports.delete = asyncHandler(async (req, res) => {
  const record = await repo.delete(req.params.id, req.user.companyId);

  if (record?.public_id) {
    await deleteAsset(record.public_id).catch((e) =>
      logger.warn(
        `Cloudinary delete failed for ${record.public_id}: ${e.message}`,
      ),
    );
  }

  res.json({ success: true, message: "Deleted" });
});
