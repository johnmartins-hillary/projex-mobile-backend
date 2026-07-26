// backend/src/routes/subcontracts.routes.js
// Mount under: router.use("/projects/:projectId/subcontracts", require("./subcontracts.routes"))

const express = require("express");
const router = express.Router({ mergeParams: true });
const { protect } = require("../middleware");
const sc = require("../controllers/subcontracts.controller");

router.get("/schedule", protect, sc.getSchedule);
router.get("/", protect, sc.getAll);
router.post("/", protect, sc.create);
router.get("/:subId/milestones", protect, sc.getMilestones);
router.post("/:subId/milestones", protect, sc.createMilestone);
router.patch("/:subId/milestones/:milestoneId", protect, sc.updateMilestone);
router.get("/:subId/payments", protect, sc.getPayments);
router.patch(
  "/:subId/payments/:paymentId/receipt",
  protect,
  sc.attachPaymentReceipt,
);
router.patch("/:subId/release-retention", protect, sc.releaseRetention);

module.exports = router;
