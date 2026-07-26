// backend/src/routes/labour.routes.js
// Mount under: router.use("/projects/:projectId/labour", require("./labour.routes"))

const express = require("express");
const router = express.Router({ mergeParams: true });
const { protect } = require("../middleware");
const labour = require("../controllers/labour.controller");

router.get("/schedule", protect, labour.getScheduleLabour);
router.get("/summary", protect, labour.getSummary);
router.get("/logs", protect, labour.getLogs);

router.put("/logs/:logId", protect, labour.updateLog);
router.delete("/logs/:logId", protect, labour.deleteLog);

module.exports = router;
