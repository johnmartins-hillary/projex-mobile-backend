// backend/src/routes/budgets.routes.js
const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate } = require("../middleware");

// Require the controller directly — no dependency on controllers/index.js
const ctrl = require("../controllers/budgets.controller");

const router = express.Router();

// ── Existing routes (unchanged) ──────────────────────────────────────────
router.get("/summary/:projectId", protect, ctrl.getSummary);
router.get("/", protect, ctrl.getAll);

router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "QS_ESTIMATOR"),
  [
    body("projectId").notEmpty().withMessage("Project ID is required"),
    body("category").trim().notEmpty(),
    body("allocated").isNumeric(),
    validate,
  ],
  ctrl.create,
);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "QS_ESTIMATOR"),
  ctrl.update,
);

// ── New: full budget health ───────────────────────────────────────────────
router.get("/health", protect, ctrl.getHealth);

module.exports = router;
