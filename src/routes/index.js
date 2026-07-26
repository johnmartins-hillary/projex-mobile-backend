const express = require("express");
const router = express.Router();

router.use("/auth", require("./auth.routes"));
router.use("/dashboard", require("./dashboard.routes"));
router.use("/projects", require("./projects.routes"));
router.use("/materials", require("./materials.routes"));
router.use("/equipment", require("./equipment.routes"));
router.use("/budgets", require("./budgets.routes"));
router.use("/expenses", require("./expenses.routes"));
router.use("/visitors", require("./visitors.routes"));
router.use("/attendance", require("./attendance.routes"));
router.use("/notifications", require("./notifications.routes"));
router.use("/sync", require("./sync.routes"));
router.use("/ai", require("./ai.routes"));
router.use("/reports", require("./reports.routes"));
router.use("/subcontracts", require("./subcontracts.routes"));
router.use("/employees", require("./employees.routes"));
router.use("/billing", require("./billing.routes"));
router.use("/uploads", require("./uploads.routes"));
router.use("/site-diary", require("./siteDiary.routes"));
router.use("/timesheets", require("./timesheets.routes"));
router.use("/maintenance", require("./maintenance.routes"));
router.use("/material-prices", require("./materialPrices.routes"));
router.use("/sms", require("./sms.routes"));
router.use("/progress-photos", require("./progressMedia.upload.routes"));
router.use("/progress-photos", require("./progressMedia.routes"));
router.use("/invoices", require("./invoices.routes"));
router.use("/defects", require("./defects.routes"));
router.use("/material-requests", require("./materialRequests.routes"));
router.use("/admin", require("./admin.routes"));
router.use("/projects/:projectId/documents", require("./documents.routes"));
router.use("/", require("./users.routes"));
router.use("/", require("./suppliers.routes"));
router.use("/", require("./clientPortal.routes"));
router.use("/", require("./marketplace.routes"));
router.use("/projects/:projectId/schedule", require("./schedule.routes"));
router.use("/projects/:projectId/chat", require("./chat.routes"));
router.use("/projects/:projectId/labour", require("./labour.routes"));
router.use(
  "/projects/:projectId/subcontracts",
  require("./subcontracts.routes"),
);
router.use("/catalog", require("./catalog.routes"));
router.use("/projects/:projectId/store", require("./store.routes"));
// New — unified payment-requests feed + approve/reject, used by the
// payment-requests screen and the dashboard's pending-payments card.
router.use("/payment-requests", require("./paymentRequests.routes"));

module.exports = router;
