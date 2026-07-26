const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

router.post(
  "/register",
  [
    body("firstName").trim().notEmpty(),
    body("lastName").trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("companyName").trim().notEmpty(),
    validate,
  ],
  ctrl.auth.register,
);

router.post(
  "/login",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
    validate,
  ],
  ctrl.auth.login,
);

router.post("/refresh", ctrl.auth.refresh);
router.post("/logout", protect, ctrl.auth.logout);

router.post(
  "/forgot-password",
  [body("email").isEmail().normalizeEmail(), validate],
  ctrl.auth.forgotPassword,
);

router.post(
  "/reset-password",
  [body("token").notEmpty(), body("password").isLength({ min: 8 }), validate],
  ctrl.auth.resetPassword,
);

router.get("/me", protect, ctrl.auth.getMe);

router.post(
  "/push-token",
  protect,
  [body("pushToken").notEmpty(), validate],
  ctrl.auth.updatePushToken,
);

module.exports = router;
