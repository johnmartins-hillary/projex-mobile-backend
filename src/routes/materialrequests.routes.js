const express = require("express");
const { protect, authorize, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /material-requests
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, status } = req.query;
    const conds = ["mr.company_id = $1"];
    const params = [req.user.companyId];
    let idx = 2;
    if (projectId) {
      conds.push(`mr.project_id = $${idx++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`mr.status = $${idx++}`);
      params.push(status);
    }
    const { rows } = await q(
      `SELECT mr.*,
       u.first_name, u.last_name,
       ab.first_name AS approved_first, ab.last_name AS approved_last,
       p.name AS project_name,
       (SELECT json_agg(mri.* ORDER BY mri.created_at) FROM material_request_items mri WHERE mri.request_id=mr.id) AS items
       FROM material_requests mr
       LEFT JOIN users u ON u.id=mr.requested_by_id
       LEFT JOIN users ab ON ab.id=mr.approved_by_id
       LEFT JOIN projects p ON p.id=mr.project_id
       WHERE ${conds.join(" AND ")} ORDER BY mr.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /material-requests
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, title, priority, neededBy, notes, items } = req.body;
    if (!projectId || !title || !items?.length) {
      return res
        .status(400)
        .json({
          success: false,
          message: "projectId, title and items required",
        });
    }
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM material_requests WHERE company_id=$1",
      [req.user.companyId],
    );
    const requestNumber = `MRQ-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;
    const { rows } = await q(
      `INSERT INTO material_requests
       (company_id, project_id, request_number, title, priority, needed_by, notes, requested_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user.companyId,
        projectId,
        requestNumber,
        title,
        priority || "NORMAL",
        neededBy || null,
        notes || null,
        req.user.userId,
      ],
    );
    for (const item of items) {
      const total = Number(item.quantity) * Number(item.unitPrice || 0);
      await q(
        `INSERT INTO material_request_items (request_id, material_name, quantity, unit, unit_price, total, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          rows[0].id,
          item.materialName,
          item.quantity,
          item.unit || "units",
          item.unitPrice || 0,
          total,
          item.notes || null,
        ],
      );
    }
    const { rows: full } = await q(
      `SELECT mr.*, u.first_name, u.last_name, p.name AS project_name,
       (SELECT json_agg(mri.*) FROM material_request_items mri WHERE mri.request_id=mr.id) AS items
       FROM material_requests mr
       LEFT JOIN users u ON u.id=mr.requested_by_id
       LEFT JOIN projects p ON p.id=mr.project_id
       WHERE mr.id=$1`,
      [rows[0].id],
    );
    res.status(201).json({ success: true, data: full[0] });
  }),
);

// PATCH /material-requests/:id/approve  ← before /:id
router.patch(
  "/:id/approve",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE material_requests SET status='APPROVED', approved_by_id=$1, approved_at=NOW(), updated_at=NOW()
       WHERE id=$2 AND company_id=$3 RETURNING *`,
      [req.user.userId, req.params.id, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Request not found");
    try {
      const { rows: items } = await q(
        "SELECT * FROM material_request_items WHERE request_id=$1",
        [req.params.id],
      );
      const { rows: countRows } = await q(
        "SELECT COUNT(*) FROM purchase_orders WHERE company_id=$1",
        [req.user.companyId],
      );
      const poNumber = `PO-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;
      const total = items.reduce((s, it) => s + Number(it.total), 0);
      const { rows: poRows } = await q(
        `INSERT INTO purchase_orders (company_id, project_id, po_number, total_amount, status, notes)
         VALUES ($1,$2,$3,$4,'DRAFT',$5) RETURNING *`,
        [
          req.user.companyId,
          rows[0].project_id,
          poNumber,
          total,
          `Auto-created from ${rows[0].request_number}`,
        ],
      );
      for (const item of items) {
        await q(
          `INSERT INTO purchase_order_items (po_id, description, quantity, unit, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            poRows[0].id,
            item.material_name,
            item.quantity,
            item.unit,
            item.unit_price,
            item.total,
          ],
        );
      }
      await q(
        "UPDATE material_requests SET status='ORDERED', updated_at=NOW() WHERE id=$1",
        [req.params.id],
      );
    } catch (e) {
      console.warn("Auto PO creation failed:", e);
    }
    res.json({ success: true, data: rows[0], message: "Request approved" });
  }),
);

// PATCH /material-requests/:id/reject  ← before /:id
router.patch(
  "/:id/reject",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"),
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE material_requests SET status='REJECTED', rejection_reason=$1, updated_at=NOW()
       WHERE id=$2 AND company_id=$3 RETURNING *`,
      [
        req.body.reason || "No reason provided",
        req.params.id,
        req.user.companyId,
      ],
    );
    if (!rows[0]) throw new Error("Request not found");
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /material-requests/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q(
      "DELETE FROM material_requests WHERE id=$1 AND company_id=$2 AND status='PENDING'",
      [req.params.id, req.user.companyId],
    );
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
