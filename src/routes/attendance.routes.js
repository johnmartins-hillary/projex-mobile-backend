const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// POST  /attendance/check-in
router.post(
  "/check-in",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.attendance.checkIn,
);

// PATCH /attendance/:id/check-out
router.patch("/:id/check-out", protect, ctrl.attendance.checkOut);

// GET   /attendance
router.get("/", protect, ctrl.attendance.getAll);

module.exports = router;
