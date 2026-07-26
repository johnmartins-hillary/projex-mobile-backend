const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// GET /invoices
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { projectId, status } = req.query;
    const conds = ["i.company_id = $1"];
    const params = [req.user.companyId];
    let idx = 2;
    if (projectId) {
      conds.push(`i.project_id = $${idx++}`);
      params.push(projectId);
    }
    if (status) {
      conds.push(`i.status = $${idx++}`);
      params.push(status);
    }
    const { rows } = await q(
      `SELECT i.*, p.name AS project_name,
       (SELECT json_agg(ii.*) FROM invoice_items ii WHERE ii.invoice_id=i.id) AS items
       FROM invoices i LEFT JOIN projects p ON p.id=i.project_id
       WHERE ${conds.join(" AND ")} ORDER BY i.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /invoices
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      issueDate,
      dueDate,
      taxRate,
      discount,
      notes,
      paymentTerms,
      items,
    } = req.body;
    if (!projectId || !clientName || !items?.length) {
      return res
        .status(400)
        .json({
          success: false,
          message: "projectId, clientName and items required",
        });
    }
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM invoices WHERE company_id=$1",
      [req.user.companyId],
    );
    const invoiceNumber = `INV-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;
    const subtotal = items.reduce(
      (s, it) => s + Number(it.quantity) * Number(it.unitPrice),
      0,
    );
    const taxAmount = subtotal * (Number(taxRate || 7.5) / 100);
    const total = subtotal + taxAmount - Number(discount || 0);
    const { rows } = await q(
      `INSERT INTO invoices
       (company_id, project_id, invoice_number, client_name, client_email, client_phone,
        client_address, issue_date, due_date, status, subtotal, tax_rate, tax_amount,
        discount, total, notes, payment_terms, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        req.user.companyId,
        projectId,
        invoiceNumber,
        clientName,
        clientEmail || null,
        clientPhone || null,
        clientAddress || null,
        issueDate || new Date(),
        dueDate || null,
        subtotal,
        taxRate || 7.5,
        taxAmount,
        discount || 0,
        total,
        notes || null,
        paymentTerms || "Payment due within 30 days",
        req.user.userId,
      ],
    );
    for (const item of items) {
      await q(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit, unit_price, total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          rows[0].id,
          item.description,
          item.quantity,
          item.unit || "item",
          item.unitPrice,
          Number(item.quantity) * Number(item.unitPrice),
        ],
      );
    }
    const { rows: full } = await q(
      `SELECT i.*, p.name AS project_name,
       (SELECT json_agg(ii.*) FROM invoice_items ii WHERE ii.invoice_id=i.id) AS items
       FROM invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=$1`,
      [rows[0].id],
    );
    res.status(201).json({ success: true, data: full[0] });
  }),
);

// PATCH /invoices/:id/status  ← before /:id
router.patch(
  "/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { status, paidAmount } = req.body;
    const valid = ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"];
    if (!valid.includes(status))
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    const isPaid = status === "PAID";
    const { rows } = await q(
      `UPDATE invoices SET status=$1,
       paid_at=CASE WHEN $2 THEN NOW() ELSE paid_at END,
       paid_amount=CASE WHEN $2 THEN $3 ELSE paid_amount END,
       updated_at=NOW()
       WHERE id=$4 AND company_id=$5 RETURNING *`,
      [status, isPaid, paidAmount || null, req.params.id, req.user.companyId],
    );
    if (!rows[0]) throw new Error("Invoice not found");
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /invoices/:id
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q(
      "DELETE FROM invoices WHERE id=$1 AND company_id=$2 AND status='DRAFT'",
      [req.params.id, req.user.companyId],
    );
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
