const express = require("express");
const { dashboard } = require("../controllers/dashboard.controller");
const { protect } = require("../middleware");

const router = express.Router();

// GET /api/v1/dashboard?projectId=<uuid>
router.get("/", protect, dashboard.getSummary);

module.exports = router;
