const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate, asyncHandler } = require("../middleware");
const ctrl = require("../controllers");
const { query: q } = require("../config/database");

const router = express.Router();

router.get("/", protect, ctrl.projects.getAll);

router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  [body("name").trim().notEmpty(), body("type").trim().notEmpty(), validate],
  ctrl.projects.create,
);

router.get(
  "/switcher",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT id, name, type, status, location FROM projects WHERE company_id=$1 AND status='ACTIVE' ORDER BY name",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

router.get("/:id", protect, ctrl.projects.getOne);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  ctrl.projects.update,
);

router.delete(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  ctrl.projects.delete,
);

module.exports = router;
