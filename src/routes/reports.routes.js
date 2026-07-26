const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// GET /reports/materials/pdf
router.get("/materials/pdf", protect, ctrl.reports.materialsPDF);

// GET /reports/budget/pdf
router.get("/budget/pdf", protect, ctrl.reports.budgetPDF);

// GET /reports/visitors/pdf
router.get("/visitors/pdf", protect, ctrl.reports.visitorsPDF);

// GET /reports/materials/excel
router.get("/materials/excel", protect, ctrl.reports.materialsExcel);

// GET /reports/weekly
router.get(
  "/weekly",
  protect,
  asyncHandler(async (req, res) => {
    const {
      generateWeeklyReport,
      formatWhatsAppReport,
    } = require("../services/weeklyReport.service");
    const data = await generateWeeklyReport(req.user.companyId);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "No active projects found" });
    const message = formatWhatsAppReport(data);
    res.json({ success: true, data: { message, raw: data } });
  }),
);

module.exports = router;
