// backend/src/routes/paymentRequests.routes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/paymentRequests.controller");
const { protect, authorize } = require("../middleware");

// Approving/rejecting the REQUEST is owner-tier only — deliberately
// excludes plain ADMIN, same convention as store.routes.js's ownerOnly.
const ownerOnly = authorize("SUPER_ADMIN", "PROJECT_OWNER");
// Creating a request and confirming an approved one (the one-tap action)
// use the broader tier — same roles that could previously record a
// payment directly.
const owner = authorize("SUPER_ADMIN", "PROJECT_OWNER", "ADMIN");

router.get("/", protect, ctrl.getPendingRequests);
router.post("/", protect, owner, ctrl.create);
router.patch("/:id/approve", protect, ownerOnly, ctrl.approve);
router.patch("/:id/reject", protect, ownerOnly, ctrl.reject);
router.patch("/:id/confirm", protect, owner, ctrl.confirm);

module.exports = router;
