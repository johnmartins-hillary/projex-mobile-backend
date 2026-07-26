const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// GET  /sync/pull
router.get("/pull", protect, ctrl.sync.pull);

// POST /sync/push
router.post(
  "/push",
  protect,
  [body("operations").isArray(), validate],
  ctrl.sync.push,
);

module.exports = router;
