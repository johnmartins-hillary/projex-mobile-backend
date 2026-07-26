const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /material-prices/summary  ← must be before /:id
router.get(
  "/summary",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT material_name, category, unit,
       MAX(price) AS max_price, MIN(price) AS min_price,
       ROUND(AVG(price), 2) AS avg_price, COUNT(*)::int AS records,
       MAX(recorded_at) AS last_updated,
       (ARRAY_AGG(price ORDER BY recorded_at DESC))[1] AS latest_price,
       (ARRAY_AGG(price ORDER BY recorded_at DESC))[2] AS previous_price
       FROM material_prices
       WHERE company_id=$1
       GROUP BY material_name, category, unit
       ORDER BY material_name`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// GET /material-prices
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { materialName, category, limit = 50 } = req.query;
    const conds = ["mp.company_id = $1"];
    const params = [req.user.companyId];
    let i = 2;
    if (materialName) {
      conds.push(`mp.material_name ILIKE $${i++}`);
      params.push(`%${materialName}%`);
    }
    if (category) {
      conds.push(`mp.category = $${i++}`);
      params.push(category);
    }
    params.push(Number(limit));
    const { rows } = await q(
      `SELECT mp.*, u.first_name, u.last_name
       FROM material_prices mp
       LEFT JOIN users u ON u.id = mp.recorded_by_id
       WHERE ${conds.join(" AND ")}
       ORDER BY mp.material_name, mp.recorded_at DESC
       LIMIT $${i}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// DELETE /material-prices/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM material_prices WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
