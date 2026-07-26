const express = require("express");
const { protect } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// GET   /notifications
router.get("/", protect, ctrl.notifications.getAll);

// PATCH /notifications/read-all   ← must be before /:id/read
router.patch("/read-all", protect, ctrl.notifications.readAll);

// PATCH /notifications/:id/read
router.patch("/:id/read", protect, ctrl.notifications.readOne);

module.exports = router;
