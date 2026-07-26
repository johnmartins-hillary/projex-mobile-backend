// backend/src/routes/catalog.routes.js
//
// Company-wide resource catalog (all 4 types: LABOUR/MATERIAL/EQUIPMENT/
// SUBCONTRACT). Deliberately NOT nested under /projects/:projectId — the
// controller functions here (store.controller.js's getCatalog etc.) only
// ever use req.user.companyId, never a projectId, so this needs to be a
// flat top-level route to match. Reuses store.controller.js's catalog
// exports rather than duplicating them in a separate controller file.
//
// Mount this in your main router alongside the other top-level routers,
// e.g.:
//   app.use("/api/v1/catalog", require("./routes/catalog.routes"));
// (adjust the prefix to match your existing convention — I don't have
// your top-level app/router file to confirm the exact mounting pattern.)

const express = require("express");
const ctrl = require("../controllers/store.controller");
const { protect, authorize } = require("../middleware");

const router = express.Router();
const owner = authorize("SUPER_ADMIN", "PROJECT_OWNER", "ADMIN");

router.get("/", protect, ctrl.getCatalog);
router.post("/", protect, owner, ctrl.createCatalogItem);
router.put("/:catalogItemId", protect, owner, ctrl.updateCatalogItem);
router.delete("/:catalogItemId", protect, owner, ctrl.deleteCatalogItem);

module.exports = router;
