const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

router.get("/", protect, ctrl.expenses.getAll);

router.post(
  "/",
  protect,
  [
    body("projectId").notEmpty().withMessage("Project ID is required"),
    body("category").trim().notEmpty(),
    body("description").trim().notEmpty(),
    body("amount").isNumeric(),
    validate,
  ],
  ctrl.expenses.create,
);

router.patch(
  "/:id/approve",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"),
  ctrl.expenses.approve,
);

router.patch(
  "/:id/reject",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"),
  ctrl.expenses.reject,
);

router.delete("/:id", protect, ctrl.expenses.delete);

module.exports = router;
