const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// GET  /visitors
router.get("/", protect, ctrl.visitors.getAll);

// POST /visitors
router.post(
  "/",
  protect,
  [
    body("projectId").isUUID(),
    body("fullName").trim().notEmpty(),
    body("purpose").trim().notEmpty(),
    validate,
  ],
  ctrl.visitors.create,
);

// PATCH /visitors/:id/checkout
router.patch("/:id/checkout", protect, ctrl.visitors.checkout);

// DELETE /visitors/:id
router.delete("/:id", protect, ctrl.visitors.delete);

module.exports = router;
