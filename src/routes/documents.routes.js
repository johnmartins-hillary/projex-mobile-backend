const express = require("express");
const { documents } = require("../controllers/documents.controller");
const { protect } = require("../middleware");

const router = express.Router({ mergeParams: true });

router.get("/sign", protect, documents.sign);
router.get("/", protect, documents.getAll);
router.post("/", protect, documents.create);
router.get("/:id", protect, documents.getOne);
router.delete("/:id", protect, documents.delete);
router.post("/:id/versions", protect, documents.addVersion);
router.delete("/:id/versions/:versionId", protect, documents.deleteVersion);

module.exports = router;
