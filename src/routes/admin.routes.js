const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

const requireProjexAdmin = (req, res, next) => {
  if (req.user.role !== "SUPER_ADMIN_PROJEX") {
    return res
      .status(403)
      .json({ success: false, message: "Projex admin access required" });
  }
  next();
};

// ── DASHBOARD ─────────────────────────────────────────────────
router.get(
  "/dashboard",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const [
      { rows: orders },
      { rows: escrow },
      { rows: companies },
      { rows: suppliers },
      { rows: revenue },
    ] = await Promise.all([
      q(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN status='PENDING' THEN 1 END) AS pending, COUNT(CASE WHEN status='DELIVERED' THEN 1 END) AS delivered, COUNT(CASE WHEN status='CANCELLED' THEN 1 END) AS cancelled FROM marketplace_orders`,
      ),
      q(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN status='HOLDING' THEN 1 END) AS holding, COALESCE(SUM(CASE WHEN status='HOLDING' THEN amount END), 0) AS holding_amount, COALESCE(SUM(CASE WHEN status='RELEASED' THEN commission_amount END), 0) AS total_commission FROM escrow_transactions`,
      ),
      q(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN plan='PRO' THEN 1 END) AS pro, COUNT(CASE WHEN plan='ENTERPRISE' THEN 1 END) AS enterprise FROM companies`,
      ),
      q(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN is_verified=TRUE THEN 1 END) AS verified FROM supplier_profiles`,
      ),
      q(
        `SELECT COALESCE(SUM(commission_amount), 0) AS total_commission, COALESCE(SUM(amount), 0) AS total_gmv FROM escrow_transactions WHERE status='RELEASED'`,
      ),
    ]);
    res.json({
      success: true,
      data: {
        orders: orders[0],
        escrow: escrow[0],
        companies: companies[0],
        suppliers: suppliers[0],
        revenue: revenue[0],
      },
    });
  }),
);

// ── ORDERS ────────────────────────────────────────────────────
router.get(
  "/orders",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;
    const conds = ["1=1"];
    const params = [];
    let i = 1;
    if (status) {
      conds.push(`mo.status = $${i++}`);
      params.push(status);
    }
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await q(
      `SELECT mo.*, sp.business_name AS supplier_name, c.name AS company_name,
      et.status AS escrow_status, et.amount AS escrow_amount, et.commission_amount, et.supplier_amount,
      et.held_at, et.released_at, et.refunded_at,
      (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
     FROM marketplace_orders mo
     JOIN supplier_profiles sp ON sp.id = mo.supplier_id
     JOIN companies c ON c.id = mo.company_id
     LEFT JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE ${conds.join(" AND ")}
     ORDER BY mo.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/orders/:id/release",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      emitPaymentUpdate,
      initiateSupplierPayout,
    } = require("../services/socket.service");
    const { rows: orderRows } = await q(
      `SELECT mo.*, et.amount, et.commission_amount, et.supplier_amount, et.id AS escrow_tx_id, et.status AS escrow_status
     FROM marketplace_orders mo
     JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE mo.id = $1`,
      [req.params.id],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    const order = orderRows[0];
    if (order.status !== "DELIVERED") {
      return res
        .status(400)
        .json({
          success: false,
          message: `Cannot release payment — order is ${order.status}. Company must confirm delivery first.`,
        });
    }
    if (order.escrow_status === "RELEASED")
      return res
        .status(400)
        .json({ success: false, message: "Payment already released" });
    const { rows: supplierBankRows } = await q(
      "SELECT bank_name, account_number, account_name FROM supplier_profiles WHERE id=$1",
      [order.supplier_id],
    );
    const supplier = supplierBankRows[0];
    const payout = await initiateSupplierPayout(
      order.supplier_id,
      Number(order.supplier_amount),
      order.order_number,
      order.payment_reference,
    );
    if (!payout.success && payout.manual) {
      await q(
        `UPDATE escrow_transactions SET status = 'RELEASED', released_at = NOW(), released_by = $1, notes = $2, updated_at = NOW() WHERE id = $3`,
        [
          req.user.userId,
          `Manual payout required: ${payout.message}`,
          order.escrow_tx_id,
        ],
      );
      await q(
        "UPDATE marketplace_orders SET escrow_released=TRUE, updated_at=NOW() WHERE id=$1",
        [req.params.id],
      );
      emitPaymentUpdate(req.app, {
        companyId: order.company_id,
        supplierId: order.supplier_id,
        payment: {
          orderId: order.id,
          orderNumber: order.order_number,
          amount: order.supplier_amount,
          status: "RELEASED",
          message: `Payment approved. Manual bank transfer required.`,
        },
      });
      return res.json({
        success: true,
        message: `⚠️ Payment approved but requires manual transfer:\n${payout.message}\n\nPlease transfer ₦${Number(order.supplier_amount).toLocaleString("en-NG")} to:\nBank: ${supplier?.bank_name || "N/A"}\nAccount: ${supplier?.account_number || "N/A"}\nName: ${supplier?.account_name || "N/A"}`,
        data: { manual: true },
      });
    }
    if (!payout.success)
      return res
        .status(500)
        .json({ success: false, message: payout.message || "Transfer failed" });
    await q(
      `UPDATE escrow_transactions SET status = 'RELEASED', released_at = NOW(), released_by = $1, paystack_transfer_code = $2, updated_at = NOW() WHERE id = $3`,
      [req.user.userId, payout.transferCode, order.escrow_tx_id],
    );
    await q(
      "UPDATE marketplace_orders SET escrow_released=TRUE, updated_at=NOW() WHERE id=$1",
      [req.params.id],
    );
    emitPaymentUpdate(req.app, {
      companyId: order.company_id,
      supplierId: order.supplier_id,
      payment: {
        orderId: order.id,
        orderNumber: order.order_number,
        amount: order.supplier_amount,
        status: "RELEASED",
        transferCode: payout.transferCode,
        message: `₦${Number(order.supplier_amount).toLocaleString("en-NG")} sent to supplier`,
      },
    });
    res.json({
      success: true,
      message: `✓ ₦${Number(order.supplier_amount).toLocaleString("en-NG")} transfer initiated to supplier.`,
      data: { transferCode: payout.transferCode },
    });
  }),
);

router.post(
  "/orders/:id/refund",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { emitPaymentUpdate } = require("../services/socket.service");
    const { reason } = req.body;
    const { rows: orderRows } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1",
      [req.params.id],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    const order = orderRows[0];
    await q(
      `UPDATE escrow_transactions SET status='REFUNDED', refunded_at=NOW(), notes=$1, updated_at=NOW() WHERE id=$2`,
      [reason || "Admin refund", order.escrow_id],
    );
    await q(
      "UPDATE marketplace_orders SET status='CANCELLED', updated_at=NOW() WHERE id=$1",
      [req.params.id],
    );
    emitPaymentUpdate(req.app, {
      companyId: order.company_id,
      supplierId: order.supplier_id,
      payment: {
        orderId: order.id,
        status: "REFUNDED",
        message: "Payment refunded by admin",
      },
    });
    res.json({
      success: true,
      message: "Order cancelled and payment refunded",
    });
  }),
);

// ── ESCROW ────────────────────────────────────────────────────
router.get(
  "/escrow",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT et.*, mo.order_number, mo.status AS order_status, c.name AS company_name, c.email AS company_email, sp.business_name AS supplier_name
     FROM escrow_transactions et
     JOIN marketplace_orders mo ON mo.id = et.order_id
     JOIN companies c ON c.id = et.company_id
     JOIN supplier_profiles sp ON sp.id = et.supplier_id
     ORDER BY et.created_at DESC LIMIT 100`,
    );
    res.json({ success: true, data: rows });
  }),
);

// ── SUPPLIERS ─────────────────────────────────────────────────
router.get(
  "/suppliers",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*, u.email, u.first_name, u.last_name, u.created_at AS user_created,
      COUNT(DISTINCT p.id) AS product_count, COUNT(DISTINCT mo.id) AS order_count,
      COALESCE(SUM(et.supplier_amount) FILTER (WHERE et.status='RELEASED'), 0) AS total_earned
     FROM supplier_profiles sp
     JOIN users u ON u.id = sp.user_id
     LEFT JOIN supplier_products p ON p.supplier_id = sp.id
     LEFT JOIN marketplace_orders mo ON mo.supplier_id = sp.id
     LEFT JOIN escrow_transactions et ON et.supplier_id = sp.id
     GROUP BY sp.id, u.email, u.first_name, u.last_name, u.created_at
     ORDER BY sp.created_at DESC`,
    );
    res.json({ success: true, data: rows });
  }),
);

router.patch(
  "/suppliers/:id/verify",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE supplier_profiles SET is_verified=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.body.verified, req.params.id],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── COMPANIES ─────────────────────────────────────────────────
router.get(
  "/companies",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT c.*, COUNT(DISTINCT p.id) AS project_count, COUNT(DISTINCT u.id) AS user_count, COUNT(DISTINCT mo.id) AS order_count
     FROM companies c
     LEFT JOIN projects p ON p.company_id = c.id
     LEFT JOIN users u ON u.company_id = c.id
     LEFT JOIN marketplace_orders mo ON mo.company_id = c.id
     GROUP BY c.id ORDER BY c.created_at DESC`,
    );
    res.json({ success: true, data: rows });
  }),
);

// ── COMMISSION ─────────────────────────────────────────────────
router.get(
  "/commission",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q("SELECT * FROM commission_settings LIMIT 1");
    res.json({
      success: true,
      data: rows[0] || { global_rate: 3, minimum_amount: 500 },
    });
  }),
);

router.put(
  "/commission",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { globalRate, minimumAmount } = req.body;
    const { rows } = await q(
      `INSERT INTO commission_settings (global_rate, minimum_amount, updated_by, updated_at, singleton) VALUES ($1, $2, $3, NOW(), true)
     ON CONFLICT (singleton) DO UPDATE SET global_rate = $1, minimum_amount = $2, updated_by = $3, updated_at = NOW() RETURNING *`,
      [globalRate, minimumAmount, req.user.userId],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/commission/supplier/:supplierId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rate, note } = req.body;
    const { rows } = await q(
      `UPDATE supplier_profiles SET custom_commission_rate = $1, commission_note = $2 WHERE id = $3 RETURNING *`,
      [rate ?? null, note || null, req.params.supplierId],
    );
    if (!rows.length) throw new Error("Supplier not found");
    res.json({ success: true, data: rows[0] });
  }),
);

// ── PLANS ─────────────────────────────────────────────────────
router.get(
  "/plans",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q("SELECT * FROM plans ORDER BY sort_order ASC");
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/plans",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      id,
      name,
      price,
      description,
      maxProjects,
      maxUsers,
      features,
      isFree,
      isPopular,
      sortOrder,
    } = req.body;
    const { rows } = await q(
      `INSERT INTO plans (id, name, price, description, max_projects, max_users, features, is_free, is_popular, sort_order, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
      [
        id.toUpperCase(),
        name,
        price || 0,
        description || null,
        maxProjects,
        maxUsers,
        JSON.stringify(features || []),
        isFree || false,
        isPopular || false,
        sortOrder || 0,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/plans/:planId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      price,
      description,
      maxProjects,
      maxUsers,
      features,
      isFree,
      isPopular,
      isActive,
      sortOrder,
    } = req.body;
    const { rows } = await q(
      `UPDATE plans SET name = COALESCE($1, name), price = COALESCE($2, price), description = COALESCE($3, description), max_projects = COALESCE($4, max_projects), max_users = COALESCE($5, max_users), features = COALESCE($6, features), is_free = COALESCE($7, is_free), is_popular = COALESCE($8, is_popular), is_active = COALESCE($9, is_active), sort_order = COALESCE($10, sort_order), updated_at = NOW() WHERE id = $11 RETURNING *`,
      [
        name,
        price,
        description,
        maxProjects,
        maxUsers,
        features ? JSON.stringify(features) : null,
        isFree,
        isPopular,
        isActive,
        sortOrder,
        req.params.planId,
      ],
    );
    if (!rows.length) throw new Error("Plan not found");
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/plans/:planId",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "UPDATE plans SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id",
      [req.params.planId],
    );
    if (!rows.length) throw new Error("Plan not found");
    res.json({ success: true, message: "Plan deactivated" });
  }),
);

router.put(
  "/companies/:companyId/plan",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { planId, trialDays, note } = req.body;
    const { rows: planRows } = await q("SELECT * FROM plans WHERE id = $1", [
      planId,
    ]);
    if (!planRows.length) throw new Error("Plan not found");
    const plan = planRows[0];
    const trialEndsAt = trialDays
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      : null;
    const { rows } = await q(
      `UPDATE companies SET plan = $1, max_projects = $2, max_users = $3, plan_expires_at = $4, trial_ends_at = $5, plan_override_by = $6, plan_override_note = $7, updated_at = NOW() WHERE id = $8 RETURNING *`,
      [
        plan.id,
        plan.max_projects,
        plan.max_users,
        trialEndsAt,
        trialEndsAt,
        req.user.userId,
        note || null,
        req.params.companyId,
      ],
    );
    if (!rows.length) throw new Error("Company not found");
    res.json({
      success: true,
      data: rows[0],
      message: `Plan updated to ${plan.name}`,
    });
  }),
);

// ── PAYMENTS ──────────────────────────────────────────────────
router.get(
  "/payments",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, plan, status } = req.query;
    const offset = (page - 1) * limit;
    let where = "WHERE p.status = 'success'";
    const params = [];
    if (plan) {
      params.push(plan);
      where += ` AND s.plan = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows: payments } = await q(
      `SELECT p.id, p.amount, p.status, p.paid_at, p.paystack_ref, p.created_at, p.metadata, s.plan, s.started_at, s.expires_at, c.name AS company_name, u.email AS company_email, u.first_name, u.last_name
     FROM payments p
     LEFT JOIN subscriptions s ON s.id = p.subscription_id
     LEFT JOIN companies c ON c.id = p.company_id
     LEFT JOIN users u ON u.company_id = p.company_id AND u.role = 'PROJECT_OWNER'
     ${where}
     ORDER BY p.paid_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: stats } = await q(
      `SELECT COUNT(*) FILTER (WHERE status = 'success') AS total_payments, COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total_revenue, COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND paid_at >= date_trunc('month', NOW())), 0) AS this_month, COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND paid_at >= date_trunc('month', NOW()) - interval '1 month' AND paid_at < date_trunc('month', NOW())), 0) AS last_month, COUNT(DISTINCT company_id) FILTER (WHERE status = 'success') AS paying_companies FROM payments`,
    );
    res.json({ success: true, data: { payments, stats: stats[0] } });
  }),
);

// ── SETTINGS ──────────────────────────────────────────────────
router.get(
  "/settings",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT * FROM platform_settings ORDER BY key ASC",
    );
    res.json({ success: true, data: rows });
  }),
);

router.put(
  "/settings/:key",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { value } = req.body;
    const { rows } = await q(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW() RETURNING *`,
      [req.params.key, String(value), req.user.userId],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

// ── FEATURED PLACEMENTS ───────────────────────────────────────
router.get(
  "/featured",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows: placements } = await q(
      `SELECT fp.*, sp.business_name AS supplier_name, sp2.name AS product_name, COUNT(fpp.id) FILTER (WHERE fpp.status = 'SUCCESS') AS payment_count, COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS'), 0) AS total_earned
     FROM featured_placements fp
     LEFT JOIN supplier_profiles sp ON sp.id = fp.supplier_id
     LEFT JOIN supplier_products sp2 ON sp2.id = fp.product_id
     LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id
     GROUP BY fp.id, sp.business_name, sp2.name
     ORDER BY fp.created_at DESC`,
    );
    const { rows: stats } = await q(
      `SELECT COUNT(*) FILTER (WHERE is_active = true AND ends_at > NOW()) AS active_placements, COUNT(*) FILTER (WHERE type = 'STORE' AND is_active = true AND ends_at > NOW()) AS active_stores, COUNT(*) FILTER (WHERE type = 'PRODUCT' AND is_active = true AND ends_at > NOW()) AS active_products, COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS'), 0) AS total_revenue, COALESCE(SUM(fpp.amount) FILTER (WHERE fpp.status = 'SUCCESS' AND fpp.paid_at >= date_trunc('month', NOW())), 0) AS this_month FROM featured_placements fp LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id`,
    );
    res.json({ success: true, data: { placements, stats: stats[0] } });
  }),
);

router.post(
  "/featured/grant",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { supplierId, type, productId, durationDays, notes } = req.body;
    if (!["STORE", "PRODUCT"].includes(type)) throw new Error("Invalid type");
    const now = new Date();
    const endsAt = new Date(
      now.getTime() + (durationDays || 30) * 24 * 60 * 60 * 1000,
    );
    const { rows } = await q(
      `INSERT INTO featured_placements (type, supplier_id, product_id, starts_at, ends_at, duration_days, amount_paid, payment_status, is_active, is_free, granted_by, notes) VALUES ($1, $2, $3, $4, $5, $6, 0, 'SUCCESS', true, true, $7, $8) RETURNING *`,
      [
        type,
        supplierId,
        productId || null,
        now,
        endsAt,
        durationDays || 30,
        req.user.userId,
        notes || null,
      ],
    );
    const placement = rows[0];
    await q(
      `INSERT INTO featured_placement_payments (featured_placement_id, supplier_id, amount, status, period_start, period_end, is_free, granted_by, paid_at) VALUES ($1, $2, 0, 'SUCCESS', $3, $4, true, $5, NOW())`,
      [placement.id, supplierId, now, endsAt, req.user.userId],
    );
    if (productId)
      await q("UPDATE supplier_products SET is_featured = true WHERE id = $1", [
        productId,
      ]);
    res
      .status(201)
      .json({
        success: true,
        data: placement,
        message: "Placement granted successfully",
      });
  }),
);

router.put(
  "/featured/:placementId/deactivate",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `UPDATE featured_placements SET is_active = false, cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *, product_id`,
      [req.params.placementId],
    );
    if (!rows.length) throw new Error("Placement not found");
    if (rows[0].product_id)
      await q(
        "UPDATE supplier_products SET is_featured = false WHERE id = $1",
        [rows[0].product_id],
      );
    res.json({ success: true, message: "Placement deactivated" });
  }),
);

router.post(
  "/featured/expire",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows: expired } = await q(
      `UPDATE featured_placements SET is_active = false, updated_at = NOW() WHERE is_active = true AND ends_at < NOW() RETURNING id, product_id`,
    );
    for (const p of expired) {
      if (p.product_id)
        await q(
          "UPDATE supplier_products SET is_featured = false WHERE id = $1",
          [p.product_id],
        );
    }
    res.json({
      success: true,
      message: `${expired.length} placements expired`,
    });
  }),
);

// ── ADS ────────────────────────────────────────────────────────
router.get(
  "/ads",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT *, CASE WHEN is_active AND starts_at <= NOW() AND ends_at > NOW() THEN 'LIVE' WHEN ends_at <= NOW() THEN 'EXPIRED' WHEN starts_at > NOW() THEN 'SCHEDULED' ELSE 'INACTIVE' END AS status FROM advertisements ORDER BY created_at DESC`,
    );
    const { rows: stats } = await q(
      `SELECT COUNT(*) FILTER (WHERE is_active AND ends_at > NOW()) AS live_ads, COALESCE(SUM(amount_paid), 0) AS total_revenue, COALESCE(SUM(impressions), 0) AS total_impressions, COALESCE(SUM(clicks), 0) AS total_clicks FROM advertisements`,
    );
    res.json({ success: true, data: { ads: rows, stats: stats[0] } });
  }),
);

router.post(
  "/ads",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      imageUrl,
      linkUrl,
      placement,
      advertiserName,
      advertiserContact,
      amountPaid,
      startsAt,
      endsAt,
    } = req.body;
    const { rows } = await q(
      `INSERT INTO advertisements (title, description, image_url, link_url, placement, advertiser_name, advertiser_contact, amount_paid, starts_at, ends_at, is_active, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE, $11) RETURNING *`,
      [
        title,
        description || null,
        imageUrl,
        linkUrl || null,
        placement,
        advertiserName,
        advertiserContact || null,
        amountPaid || 0,
        startsAt,
        endsAt,
        req.user.userId,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.put(
  "/ads/:id",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      imageUrl,
      linkUrl,
      placement,
      advertiserName,
      advertiserContact,
      amountPaid,
      startsAt,
      endsAt,
      isActive,
    } = req.body;
    const { rows } = await q(
      `UPDATE advertisements SET title = COALESCE($1, title), description = COALESCE($2, description), image_url = COALESCE($3, image_url), link_url = COALESCE($4, link_url), placement = COALESCE($5, placement), advertiser_name = COALESCE($6, advertiser_name), advertiser_contact = COALESCE($7, advertiser_contact), amount_paid = COALESCE($8, amount_paid), starts_at = COALESCE($9, starts_at), ends_at = COALESCE($10, ends_at), is_active = COALESCE($11, is_active), updated_at = NOW() WHERE id = $12 RETURNING *`,
      [
        title,
        description,
        imageUrl,
        linkUrl,
        placement,
        advertiserName,
        advertiserContact,
        amountPaid,
        startsAt,
        endsAt,
        isActive,
        req.params.id,
      ],
    );
    if (!rows.length) throw new Error("Ad not found");
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/admin/ads/:id",
  protect,
  requireProjexAdmin,
  asyncHandler(async (req, res) => {
    await q("DELETE FROM advertisements WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Ad deleted" });
  }),
);

module.exports = router;
