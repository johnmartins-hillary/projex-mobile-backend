const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q, withTransaction: wt } = require("../config/database");

const router = express.Router();

// GET /suppliers
router.get(
  "/suppliers",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT * FROM suppliers WHERE company_id=$1 AND is_active=TRUE ORDER BY name",
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /suppliers
router.post(
  "/suppliers",
  protect,
  asyncHandler(async (req, res) => {
    const {
      name,
      contactName,
      phone,
      email,
      address,
      category,
      rating,
      notes,
      bankName,
      accountNumber,
      accountName,
    } = req.body;
    const { rows } = await q(
      `INSERT INTO suppliers (company_id, name, contact_name, phone, email, address, category, rating, notes, bank_name, account_number, account_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.companyId,
        name,
        contactName || null,
        phone || null,
        email || null,
        address || null,
        category || null,
        rating || 0,
        notes || null,
        bankName || null,
        accountNumber || null,
        accountName || null,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PUT /suppliers/:id
router.put(
  "/suppliers/:id",
  protect,
  asyncHandler(async (req, res) => {
    const {
      name,
      contactName,
      phone,
      email,
      address,
      category,
      rating,
      notes,
      bankName,
      accountNumber,
      accountName,
    } = req.body;
    const { rows } = await q(
      `UPDATE suppliers SET name=$1, contact_name=$2, phone=$3, email=$4, address=$5,
       category=$6, rating=$7, notes=$8, bank_name=$9, account_number=$10, account_name=$11, updated_at=NOW()
       WHERE id=$12 AND company_id=$13 RETURNING *`,
      [
        name,
        contactName || null,
        phone || null,
        email || null,
        address || null,
        category || null,
        rating || 0,
        notes || null,
        bankName || null,
        accountNumber || null,
        accountName || null,
        req.params.id,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// GET /purchase-orders
router.get(
  "/purchase-orders",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT po.*, s.name AS supplier_name, p.name AS project_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id
       JOIN projects p ON p.id=po.project_id
       WHERE p.company_id=$1 ORDER BY po.created_at DESC`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /purchase-orders
router.post(
  "/purchase-orders",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, supplierId, items = [], notes, expectedAt } = req.body;
    const poNumber = `PO-${Date.now().toString().slice(-8)}`;
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const po = await wt(async (client) => {
      const { rows } = await client.query(
        "INSERT INTO purchase_orders (project_id,supplier_id,created_by_id,po_number,total_amount,notes,expected_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          projectId,
          supplierId,
          req.user.userId,
          poNumber,
          total,
          notes || null,
          expectedAt || null,
        ],
      );
      for (const item of items)
        await client.query(
          "INSERT INTO po_items (purchase_order_id,description,quantity,unit,unit_price,total_price) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            rows[0].id,
            item.description,
            item.quantity,
            item.unit,
            item.unitPrice,
            item.quantity * item.unitPrice,
          ],
        );
      return rows[0];
    });
    res.status(201).json({ success: true, data: po });
  }),
);

// PATCH /purchase-orders/:id/status
router.patch(
  "/purchase-orders/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE purchase_orders SET status=$1,delivered_at=CASE WHEN $1='DELIVERED' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.body.status, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

module.exports = router;
