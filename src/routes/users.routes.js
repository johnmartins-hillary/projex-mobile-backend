const express = require("express");
const { body } = require("express-validator");
const { protect, authorize, validate, asyncHandler } = require("../middleware");
const ctrl = require("../controllers");
const { query: q } = require("../config/database");

const router = express.Router();

// PATCH /company/branding
router.patch(
  "/company/branding",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  asyncHandler(async (req, res) => {
    const { logoUrl, primaryColor, secondaryColor, tagline, name } = req.body;
    const updated = await q(
      `UPDATE companies SET
       logo_url=COALESCE($1,logo_url), primary_color=COALESCE($2,primary_color),
       secondary_color=COALESCE($3,secondary_color), tagline=COALESCE($4,tagline),
       name=COALESCE($5,name), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [
        logoUrl || null,
        primaryColor || null,
        secondaryColor || null,
        tagline || null,
        name || null,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: updated.rows[0] });
  }),
);

// PATCH /users/avatar  ← must be before /users/:id
router.patch(
  "/users/avatar",
  protect,
  asyncHandler(async (req, res) => {
    const { avatarUrl } = req.body;
    if (!avatarUrl)
      return res
        .status(400)
        .json({ success: false, message: "avatarUrl required" });
    await q("UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2", [
      avatarUrl,
      req.user.userId,
    ]);
    res.json({ success: true });
  }),
);

// GET /users
router.get(
  "/users",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  ctrl.users.getAll,
);

// POST /users/invite  ← must be before /users/:id
router.post(
  "/users/invite",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  [body("email").isEmail().normalizeEmail(), body("role").notEmpty(), validate],
  ctrl.users.invite,
);

// PATCH /users/:id/toggle-active  ← must be before /users/:id
router.patch(
  "/users/:id/toggle-active",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SUPER_ADMIN_PROJEX"),
  ctrl.users.toggleActive,
);

// PATCH /users/:id
router.patch("/users/:id", protect, ctrl.users.update);

module.exports = router;
