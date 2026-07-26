const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");
const crypto = require("crypto");
const path = require("path");

const router = express.Router();

// ── ORDER IS CRITICAL ─────────────────────────────────────────
// /client-portal/view/:token  must come before /client-portal/:id
// /portal/:token              is a separate HTML-serving route

// GET /client-portal/view/:token  (public — no auth)
router.get(
  "/client-portal/view/:token",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT cp.*, p.name AS project_name, p.type, p.status AS project_status,
       p.location, p.start_date, p.end_date, p.description,
       p.client_name, p.client_email, p.total_budget,
       c.name AS company_name, c.logo_url AS company_logo
       FROM client_portals cp
       JOIN projects p ON p.id=cp.project_id
       JOIN companies c ON c.id=cp.company_id
       WHERE cp.token=$1 AND cp.is_active=TRUE`,
      [req.params.token],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Portal not found or expired" });
    const portal = rows[0];
    if (portal.expires_at && new Date(portal.expires_at) < new Date()) {
      return res
        .status(403)
        .json({ success: false, message: "This portal link has expired" });
    }
    await q(
      "UPDATE client_portals SET access_count=access_count+1, last_accessed_at=NOW() WHERE token=$1",
      [req.params.token],
    );
    const data = { portal, project: portal };
    if (portal.show_budget) {
      const { rows: budget } = await q(
        `SELECT category, allocated, spent, ROUND((spent/NULLIF(allocated,0))*100)::int AS percent_used
         FROM budgets WHERE project_id=$1`,
        [portal.project_id],
      );
      const totalAllocated = budget.reduce(
        (s, b) => s + Number(b.allocated),
        0,
      );
      const totalSpent = budget.reduce((s, b) => s + Number(b.spent), 0);
      data.budget = {
        categories: budget,
        totalAllocated,
        totalSpent,
        percentUsed: totalAllocated
          ? Math.round((totalSpent / totalAllocated) * 100)
          : 0,
      };
    }
    if (portal.show_materials) {
      const { rows: materials } = await q(
        `SELECT name, category, quantity, unit, status FROM materials
         WHERE company_id=(SELECT company_id FROM projects WHERE id=$1)
         ORDER BY status DESC, name LIMIT 20`,
        [portal.project_id],
      );
      data.materials = materials;
    }
    if (portal.show_expenses) {
      const { rows: expenses } = await q(
        `SELECT category, description, amount, status, expense_date FROM expenses
         WHERE project_id=$1 AND status='APPROVED' ORDER BY expense_date DESC LIMIT 10`,
        [portal.project_id],
      );
      data.expenses = expenses;
    }
    if (portal.show_photos) {
      const { rows: photos } = await q(
        `SELECT pp.title, pp.photo_url, pp.taken_at, pp.category, pp.is_milestone, pp.location
         FROM progress_photos pp WHERE pp.project_id=$1 ORDER BY pp.taken_at DESC LIMIT 12`,
        [portal.project_id],
      );
      data.photos = photos;
    }
    res.json({ success: true, data });
  }),
);

// GET /portal/:token  — serves the HTML shell (public)
router.get("/portal/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "../views/clientPortal.html"));
});

// GET /client-portal
router.get(
  "/client-portal",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT cp.*, p.name AS project_name, p.status AS project_status, u.first_name, u.last_name
       FROM client_portals cp
       JOIN projects p ON p.id=cp.project_id
       JOIN users u ON u.id=cp.created_by_id
       WHERE cp.company_id=$1 ORDER BY cp.created_at DESC`,
      [req.user.companyId],
    );
    res.json({ success: true, data: rows });
  }),
);

// POST /client-portal
router.post(
  "/client-portal",
  protect,
  asyncHandler(async (req, res) => {
    const {
      projectId,
      clientName,
      clientEmail,
      expiresAt,
      showBudget,
      showExpenses,
      showMaterials,
      showVisitors,
      showPhotos,
    } = req.body;
    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "projectId required" });
    const token = crypto.randomBytes(32).toString("hex");
    const { rows } = await q(
      `INSERT INTO client_portals
       (project_id, company_id, token, client_name, client_email, expires_at,
        show_budget, show_expenses, show_materials, show_visitors, show_photos, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        projectId,
        req.user.companyId,
        token,
        clientName || null,
        clientEmail || null,
        expiresAt || null,
        showBudget !== false,
        showExpenses || false,
        showMaterials !== false,
        showVisitors || false,
        showPhotos !== false,
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// PATCH /client-portal/:id
router.patch(
  "/client-portal/:id",
  protect,
  asyncHandler(async (req, res) => {
    const {
      isActive,
      showBudget,
      showExpenses,
      showMaterials,
      showVisitors,
      showPhotos,
      expiresAt,
    } = req.body;
    const { rows } = await q(
      `UPDATE client_portals SET
       is_active=COALESCE($1,is_active), show_budget=COALESCE($2,show_budget),
       show_expenses=COALESCE($3,show_expenses), show_materials=COALESCE($4,show_materials),
       show_visitors=COALESCE($5,show_visitors), show_photos=COALESCE($6,show_photos),
       expires_at=COALESCE($7,expires_at), updated_at=NOW()
       WHERE id=$8 AND company_id=$9 RETURNING *`,
      [
        isActive,
        showBudget,
        showExpenses,
        showMaterials,
        showVisitors,
        showPhotos,
        expiresAt || null,
        req.params.id,
        req.user.companyId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// DELETE /client-portal/:id
router.delete(
  "/client-portal/:id",
  protect,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM client_portals WHERE id=$1 AND company_id=$2", [
      req.params.id,
      req.user.companyId,
    ]);
    res.json({ success: true, message: "Deleted" });
  }),
);

module.exports = router;
