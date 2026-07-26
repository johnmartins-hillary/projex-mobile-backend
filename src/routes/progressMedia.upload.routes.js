// backend/src/routes/progressMedia.upload.routes.js
// Handles single AND bulk upload of progress photos/videos to Cloudinary

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { protect } = require("../middleware");
const { asyncHandler } = require("../middleware");
const { logger } = require("../utils/logger");

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

const router = express.Router();

// Multer — memory storage, 200MB per file, up to 20 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed =
      /image\/(jpeg|jpg|png|webp|heic)|video\/(mp4|mov|quicktime|avi|x-msvideo)/;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error(`File type not supported: ${file.mimetype}`));
  },
});

// ── Upload one file to Cloudinary ─────────────────────────────────────────────

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

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  if (resourceType === "image") {
    const base64File = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const body = new URLSearchParams({
      file: base64File,
      folder,
      timestamp: String(timestamp),
      api_key: CLOUDINARY_API_KEY,
      signature,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Cloudinary image upload failed");
    }
    return res.json();
  } else {
    const blob = new Blob([buffer], { type: mimeType });
    const formData = new globalThis.FormData();
    formData.append("file", blob, filename);
    formData.append("folder", folder);
    formData.append("timestamp", String(timestamp));
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("signature", signature);
    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Cloudinary video upload failed");
    }
    return res.json();
  }
}

// ── POST /progress-photos/upload ──────────────────────────────────────────────
// Accepts: multipart/form-data with one or many `files` fields
// Returns: { results: [{ url, publicId, mediaType, duration, originalIndex }] }

router.post(
  "/upload",
  protect,
  upload.array("files", 20), // up to 20 files at once
  asyncHandler(async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No files received" });
    }

    const companyId = req.user.companyId;
    const folder = `projex/${companyId}/progress`;

    logger.info(`Progress media bulk upload — ${files.length} files`);

    // Upload all files in parallel
    const results = await Promise.all(
      files.map(async (file, index) => {
        if (!file.buffer || file.buffer.length === 0) {
          throw new Error(`File at index ${index} is empty`);
        }
        const isVideo = file.mimetype.startsWith("video/");
        const resourceType = isVideo ? "video" : "image";
        const mediaType = isVideo ? "video" : "photo";

        const result = await uploadToCloudinary(
          file.buffer,
          file.originalname || (isVideo ? "upload.mp4" : "upload.jpg"),
          file.mimetype,
          folder,
          resourceType,
        );

        logger.info(`Cloudinary OK [${index}]: ${result.public_id}`);

        return {
          originalIndex: index,
          url: result.secure_url,
          publicId: result.public_id,
          mediaType,
          duration: result.duration ? Math.round(result.duration) : null,
          bytes: result.bytes,
        };
      }),
    );

    res.json({ success: true, data: results });
  }),
);

module.exports = router;
