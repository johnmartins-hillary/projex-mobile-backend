// backend/src/routes/store.routes.js
const express = require("express");
const ctrl = require("../controllers/store.controller");
const { protect, authorize } = require("../middleware");

const router = express.Router({ mergeParams: true });
const owner = authorize("SUPER_ADMIN", "PROJECT_OWNER", "ADMIN");

router.get("/", protect, ctrl.getStore);
router.post("/", protect, owner, ctrl.createStoreItem);

// NOTE: static/fixed-segment routes must be declared BEFORE "/:itemId",
// otherwise Express matches "unlinked-resources" as an :itemId param.
router.get("/unlinked-resources", protect, ctrl.getUnlinkedResources);

router.get("/requests", protect, ctrl.getRequests);
router.post("/requests", protect, ctrl.createRequest);
router.patch(
  "/requests/:requestId/approve",
  protect,
  owner,
  ctrl.approveRequest,
);
router.patch("/requests/:requestId/reject", protect, owner, ctrl.rejectRequest);
router.get("/wastage", protect, ctrl.getWastage);
router.post("/wastage", protect, ctrl.recordWastage);
router.put("/wastage/:wastageId", protect, ctrl.updateWastage);
router.get("/excess", protect, ctrl.getExcessMaterials);

router.get("/:itemId", protect, ctrl.getStoreItem);
router.put("/:itemId", protect, owner, ctrl.updateStoreItem);
router.patch("/:itemId/link-resource", protect, owner, ctrl.linkResource);
// NOTE: direct stock-in creation (POST /:itemId/stock-in) and its
// approve/reject-on-the-row routes are removed — under the payment-
// requests flow, a store_stock_in row is only ever created at
// confirmation time (already approved by construction), via
// paymentRequests.repository.js's confirm(). Submitting a stock purchase
// now goes through POST /payment-requests instead.
router.patch(
  "/:itemId/stock-in/:stockInId/receipt",
  protect,
  owner,
  ctrl.attachStockInReceipt,
);
router.post("/:itemId/stock-out", protect, owner, ctrl.stockOut);
router.get("/:itemId/history", protect, ctrl.getHistory);

module.exports = router;
