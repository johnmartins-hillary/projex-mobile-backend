const express = require("express");
const { body } = require("express-validator");
const { protect, validate } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

router.get("/subscription", protect, ctrl.billing.getSubscription);

router.post(
  "/initialize",
  protect,
  [body("plan").notEmpty(), body("email").isEmail(), validate],
  ctrl.billing.initialize,
);

router.post(
  "/verify",
  protect,
  [body("reference").notEmpty(), validate],
  ctrl.billing.verify,
);

router.post("/webhook", ctrl.billing.webhook);
router.get("/history", protect, ctrl.billing.getHistory);

module.exports = router;
