// backend/src/routes/equipment.routes.js
const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers/equipment.controller");

const router = express.Router();
const eq = ctrl.equipment;

router.get("/", protect, eq.getAll);
router.get("/activity", protect, eq.getAllActivity);
router.get("/schedule-resources", protect, eq.getScheduleResources);
router.post(
  "/",
  protect,
  [body("name").trim().notEmpty(), body("type").trim().notEmpty(), validate],
  eq.create,
);
router.get("/:id", protect, eq.getOne);
router.put("/:id", protect, eq.update);
router.delete("/:id", protect, eq.delete);
router.post("/:id/start-usage", protect, eq.startUsage);
router.post("/:id/end-usage", protect, eq.endUsage);
router.post("/:id/return", protect, eq.returnHire);
router.post("/:id/rehire", protect, eq.reHire);
router.post(
  "/:id/maintenance",
  protect,
  [body("description").trim().notEmpty(), validate],
  eq.logMaintenance,
);
router.get("/:id/activity", protect, eq.getActivity);

module.exports = router;
