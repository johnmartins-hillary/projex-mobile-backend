const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

router.get("/", protect, ctrl.employees.getAll);

router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  [
    body("firstName").trim().notEmpty(),
    body("lastName").trim().notEmpty(),
    validate,
  ],
  ctrl.employees.create,
);

router.get("/payroll", protect, ctrl.employees.getPayroll);
router.get("/:id", protect, ctrl.employees.getOne);
router.put("/:id", protect, ctrl.employees.update);

router.patch(
  "/:id/status",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  ctrl.employees.setStatus,
);

router.post("/:id/documents", protect, ctrl.employees.addDocument);

module.exports = router;
