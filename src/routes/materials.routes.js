const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

router.get("/low-stock", protect, ctrl.materials.getLowStock);
router.get("/", protect, ctrl.materials.getAll);
router.get("/project", protect, ctrl.materials.getProjectMaterials);
router.post("/from-resource",protect, ctrl.materials.createFromResource);
router.get("/history",       protect, ctrl.materials.getHistory);
router.post(
  "/",
  protect,
  [
    body("name").trim().notEmpty(),
    body("category").trim().notEmpty(),
    body("unit").trim().notEmpty(),
    validate,
  ],
  ctrl.materials.create,
);

router.get("/:id", protect, ctrl.materials.getOne);
router.put("/:id", protect, ctrl.materials.update);
router.delete("/:id", protect, ctrl.materials.delete);

router.post(
  "/:id/stock-in",
  protect,
  [body("quantity").isNumeric().toFloat(), validate],
  ctrl.materials.stockIn,
);

router.post(
  "/:id/stock-out",
  protect,
  [body("quantity").isNumeric().toFloat(), validate],
  ctrl.materials.stockOut,
);

module.exports = router;
