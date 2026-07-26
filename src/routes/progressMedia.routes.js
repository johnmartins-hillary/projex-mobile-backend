// backend/src/routes/progressPhotos.routes.js  (replace existing file)
// Main CRUD routes — file upload is handled separately in progressMedia.upload.routes.js

const express = require("express");
const { protect } = require("../middleware");
const ctrl = require("../controllers/progressMedia.controller");

const router = express.Router();

// GET /progress-photos/timeline  ← must be before /:id
router.get("/timeline", protect, ctrl.getTimeline);

// GET /progress-photos
router.get("/", protect, ctrl.getAll);

// POST /progress-photos  (receives plain JSON with mediaUrl after upload step)
router.post("/", protect, ctrl.create);
router.post("/bulk", protect, ctrl.bulkCreate);

// DELETE /progress-photos/:id
router.delete("/:id", protect, ctrl.delete);

module.exports = router;

// ── Mount order in your main router ──────────────────────────────────────────
// router.use("/progress-photos", require("./progressMedia.upload.routes"));  ← FIRST
// router.use("/progress-photos", require("./progressPhotos.routes"));         ← SECOND
