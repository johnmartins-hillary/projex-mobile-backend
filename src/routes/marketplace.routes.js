const express = require("express");
const { protect, asyncHandler } = require("../middleware");
const { query: q } = require("../config/database");

const router = express.Router();

// ── PUBLIC BROWSE ─────────────────────────────────────────────
router.get(
  "/suppliers",
  asyncHandler(async (req, res) => {
    const {
      category,
      city,
      state,
      search,
      lat,
      lng,
      radius = 50,
      limit = 20,
      offset = 0,
    } = req.query;
    const conds = ["sp.is_active = TRUE"];
    const params = [];
    let i = 1;
    if (search) {
      conds.push(
        `(sp.business_name ILIKE $${i} OR sp.description ILIKE $${i} OR $${i} = ANY(sp.categories))`,
      );
      params.push(`%${search}%`);
      i++;
    }
    if (city) {
      conds.push(`sp.city ILIKE $${i++}`);
      params.push(`%${city}%`);
    }
    if (state) {
      conds.push(`sp.state ILIKE $${i++}`);
      params.push(`%${state}%`);
    }
    if (category) {
      conds.push(`$${i++} = ANY(sp.categories)`);
      params.push(category);
    }
    let distanceSelect = "NULL::numeric AS distance_km";
    if (lat && lng) {
      distanceSelect = `ROUND((6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude)))))::numeric, 1) AS distance_km`;
      conds.push(`sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL`);
      conds.push(
        `(6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude))))) <= $${i + 2}`,
      );
      params.push(parseFloat(lat), parseFloat(lng), parseFloat(radius));
      i += 3;
    }
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await q(
      `SELECT sp.*, ${distanceSelect},
        (SELECT COUNT(*) FROM supplier_products WHERE supplier_id = sp.id AND is_available = TRUE) AS product_count,
        (SELECT json_agg(p.*) FROM supplier_products p WHERE p.supplier_id = sp.id AND p.is_available = TRUE LIMIT 4) AS featured_products,
        EXISTS (SELECT 1 FROM featured_placements fp WHERE fp.supplier_id = sp.id AND fp.type = 'STORE' AND fp.is_active = TRUE AND fp.ends_at > NOW()) AS is_featured_store
       FROM supplier_profiles sp
       WHERE ${conds.join(" AND ")}
       ORDER BY is_featured_store DESC, ${lat && lng ? "distance_km ASC," : ""} sp.is_verified DESC, sp.rating DESC, sp.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
    const { rows: countRows } = await q(
      `SELECT COUNT(*) FROM supplier_profiles sp WHERE ${conds.join(" AND ")}`,
      params.slice(0, params.length - 2),
    );
    res.json({
      success: true,
      data: rows,
      total: parseInt(countRows[0].count),
    });
  }),
);

router.get(
  "/suppliers/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*,
      (SELECT json_agg(p.* ORDER BY p.created_at DESC) FROM supplier_products p WHERE p.supplier_id = sp.id AND p.is_available = TRUE) AS products,
      (SELECT json_agg(r.*) FROM (SELECT * FROM supplier_reviews WHERE supplier_id = sp.id ORDER BY created_at DESC LIMIT 10) r) AS reviews
     FROM supplier_profiles sp
     WHERE sp.id = $1 AND sp.is_active = TRUE`,
      [req.params.id],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found" });
    res.json({ success: true, data: rows[0] });
  }),
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      lat,
      lng,
      limit = 30,
      offset = 0,
    } = req.query;
    const conds = ["p.is_available = TRUE", "sp.is_active = TRUE"];
    const params = [];
    let i = 1;
    if (search) {
      conds.push(
        `(p.name ILIKE $${i} OR p.description ILIKE $${i} OR p.category ILIKE $${i})`,
      );
      params.push(`%${search}%`);
      i++;
    }
    if (category) {
      conds.push(`p.category ILIKE $${i++}`);
      params.push(`%${category}%`);
    }
    if (minPrice) {
      conds.push(`p.price >= $${i++}`);
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      conds.push(`p.price <= $${i++}`);
      params.push(parseFloat(maxPrice));
    }
    let distanceSelect = "NULL::numeric AS supplier_distance_km";
    if (lat && lng) {
      distanceSelect = `ROUND((6371 * acos(LEAST(1, cos(radians($${i})) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians($${i + 1})) + sin(radians($${i})) * sin(radians(sp.latitude)))))::numeric, 1) AS supplier_distance_km`;
      params.push(parseFloat(lat), parseFloat(lng));
      i += 2;
    }
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await q(
      `SELECT p.*, ${distanceSelect},
        sp.business_name AS supplier_name, sp.city, sp.state,
        sp.rating AS supplier_rating, sp.is_verified,
        sp.whatsapp AS supplier_whatsapp, sp.delivery_radius_km,
        EXISTS (SELECT 1 FROM featured_placements fp WHERE fp.product_id = p.id AND fp.type = 'PRODUCT' AND fp.is_active = TRUE AND fp.ends_at > NOW()) AS is_featured_product,
        EXISTS (SELECT 1 FROM featured_placements fp2 WHERE fp2.supplier_id = p.supplier_id AND fp2.type = 'STORE' AND fp2.is_active = TRUE AND fp2.ends_at > NOW()) AS supplier_is_featured
       FROM supplier_products p
       JOIN supplier_profiles sp ON sp.id = p.supplier_id
       WHERE ${conds.join(" AND ")}
       ORDER BY is_featured_product DESC, supplier_is_featured DESC, ${lat && lng ? "supplier_distance_km ASC," : ""} sp.is_verified DESC, sp.rating DESC, p.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = [
      { id: "cement", label: "Cement", icon: "🏭" },
      { id: "sand", label: "Sand & Gravel", icon: "⛏️" },
      { id: "iron_rods", label: "Iron Rods & Steel", icon: "🔩" },
      { id: "blocks", label: "Blocks & Bricks", icon: "🧱" },
      { id: "roofing", label: "Roofing Materials", icon: "🏠" },
      { id: "tiles", label: "Tiles & Finishing", icon: "🪟" },
      { id: "plumbing", label: "Plumbing", icon: "🚿" },
      { id: "electrical", label: "Electrical", icon: "⚡" },
      { id: "timber", label: "Timber & Wood", icon: "🪵" },
      { id: "paint", label: "Paint & Chemicals", icon: "🎨" },
      { id: "tools", label: "Tools & Equipment", icon: "🔧" },
      { id: "other", label: "Other Materials", icon: "📦" },
    ];
    res.json({ success: true, data: categories });
  }),
);

// ── SUPPLIER SELF-MANAGEMENT ──────────────────────────────────
router.post(
  "/supplier/register",
  protect,
  asyncHandler(async (req, res) => {
    const existing = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (existing.rows[0])
      return res
        .status(400)
        .json({ success: false, message: "Already registered as supplier" });
    const {
      businessName,
      cacNumber,
      description,
      address,
      city,
      state,
      latitude,
      longitude,
      deliveryRadiusKm,
      whatsapp,
      phone,
      email,
      categories,
    } = req.body;
    if (!businessName || !city || !state) {
      return res
        .status(400)
        .json({
          success: false,
          message: "businessName, city and state required",
        });
    }
    const { rows } = await q(
      `INSERT INTO supplier_profiles
     (user_id, business_name, cac_number, description, address, city, state,
      latitude, longitude, delivery_radius_km, whatsapp, phone, email, categories)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.user.userId,
        businessName,
        cacNumber || null,
        description || null,
        address || null,
        city,
        state,
        latitude || null,
        longitude || null,
        deliveryRadiusKm || 50,
        whatsapp || null,
        phone || null,
        email || null,
        categories || [],
      ],
    );
    await q("UPDATE users SET role='SUPPLIER', updated_at=NOW() WHERE id=$1", [
      req.user.userId,
    ]);
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.get(
  "/supplier/me",
  protect,
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT sp.*, (SELECT json_agg(p.* ORDER BY p.created_at DESC) FROM supplier_products p WHERE p.supplier_id = sp.id) AS products
     FROM supplier_profiles sp WHERE sp.user_id = $1`,
      [req.user.userId],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    res.json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/supplier/me",
  protect,
  asyncHandler(async (req, res) => {
    const {
      businessName,
      description,
      address,
      city,
      state,
      latitude,
      longitude,
      deliveryRadiusKm,
      whatsapp,
      phone,
      categories,
      logoUrl,
      bannerUrl,
      bankName,
      bankCode,
      accountNumber,
      accountName,
    } = req.body;
    const { rows: existing } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!existing[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    let recipientCode = null;
    if (
      accountNumber &&
      bankCode &&
      accountName &&
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "nuban",
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: "NGN",
          }),
        });
        const data = await r.json();
        if (data.status) recipientCode = data.data?.recipient_code;
      } catch (e) {
        console.warn("Failed to create Paystack recipient:", e.message);
      }
    }
    const { rows } = await q(
      `UPDATE supplier_profiles SET
      business_name = COALESCE($1, business_name), description = COALESCE($2, description),
      address = COALESCE($3, address), city = COALESCE($4, city), state = COALESCE($5, state),
      latitude = COALESCE($6, latitude), longitude = COALESCE($7, longitude),
      delivery_radius_km = COALESCE($8, delivery_radius_km), whatsapp = COALESCE($9, whatsapp),
      phone = COALESCE($10, phone), categories = COALESCE($11, categories),
      logo_url = COALESCE($12, logo_url), banner_url = COALESCE($13, banner_url),
      bank_name = COALESCE($14, bank_name), bank_code = COALESCE($15, bank_code),
      account_number = COALESCE($16, account_number), account_name = COALESCE($17, account_name),
      paystack_recipient_code = COALESCE($18, paystack_recipient_code), updated_at = NOW()
     WHERE user_id = $19 RETURNING *`,
      [
        businessName,
        description,
        address,
        city,
        state,
        latitude,
        longitude,
        deliveryRadiusKm,
        whatsapp,
        phone,
        categories,
        logoUrl,
        bannerUrl,
        bankName,
        bankCode,
        accountNumber,
        accountName,
        recipientCode,
        req.user.userId,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.post(
  "/supplier/verify-bank",
  protect,
  asyncHandler(async (req, res) => {
    const { accountNumber, bankCode } = req.body;
    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );
        const data = await r.json();
        if (data.status) return res.json({ success: true, data: data.data });
        return res
          .status(400)
          .json({
            success: false,
            message: data.message || "Could not verify account",
          });
      } catch (e) {
        return res
          .status(500)
          .json({ success: false, message: "Verification failed" });
      }
    }
    res.json({
      success: true,
      data: {
        account_name: "TEST ACCOUNT NAME",
        account_number: accountNumber,
      },
    });
  }),
);

// ── SUPPLIER PRODUCTS ─────────────────────────────────────────
router.get(
  "/supplier/products",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    const { rows } = await q(
      "SELECT * FROM supplier_products WHERE supplier_id=$1 ORDER BY created_at DESC",
      [supplier[0].id],
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/supplier/products",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Register as supplier first" });
    const {
      name,
      description,
      category,
      unit,
      price,
      minOrder,
      maxOrder,
      availableQuantity,
      images,
    } = req.body;
    if (!name || !category || !unit || !price) {
      return res
        .status(400)
        .json({
          success: false,
          message: "name, category, unit and price required",
        });
    }
    const imagesValue = images?.length
      ? `{${images.map((i) => `"${i}"`).join(",")}}`
      : "{}";
    const { rows } = await q(
      `INSERT INTO supplier_products
     (supplier_id, name, description, category, unit, price, min_order, max_order, available_quantity, images)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        supplier[0].id,
        name,
        description || null,
        category,
        unit,
        price,
        minOrder || 1,
        maxOrder || null,
        availableQuantity || null,
        imagesValue,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/supplier/products/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    if (!supplier[0])
      return res
        .status(404)
        .json({ success: false, message: "Supplier profile not found" });
    const {
      name,
      description,
      category,
      unit,
      price,
      minOrder,
      availableQuantity,
      images,
      isAvailable,
    } = req.body;
    const imagesValue = images
      ? `{${images.map((i) => `"${i}"`).join(",")}}`
      : null;
    const { rows } = await q(
      `UPDATE supplier_products SET
      name = COALESCE($1, name), description = COALESCE($2, description),
      category = COALESCE($3, category), unit = COALESCE($4, unit),
      price = COALESCE($5, price), min_order = COALESCE($6, min_order),
      available_quantity = COALESCE($7, available_quantity),
      images = COALESCE($8, images), is_available = COALESCE($9, is_available), updated_at = NOW()
     WHERE id = $10 AND supplier_id = $11 RETURNING *`,
      [
        name,
        description,
        category,
        unit,
        price,
        minOrder,
        availableQuantity,
        imagesValue,
        isAvailable,
        req.params.id,
        supplier[0].id,
      ],
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.delete(
  "/supplier/products/:id",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: supplier } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id=$1",
      [req.user.userId],
    );
    await q("DELETE FROM supplier_products WHERE id=$1 AND supplier_id=$2", [
      req.params.id,
      supplier[0]?.id,
    ]);
    res.json({ success: true, message: "Product deleted" });
  }),
);

// ── ORDERS ────────────────────────────────────────────────────
router.post(
  "/orders",
  protect,
  asyncHandler(async (req, res) => {
    const {
      supplierId,
      projectId,
      items,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      notes,
      expectedDeliveryDate,
    } = req.body;
    if (!supplierId || !items?.length)
      return res
        .status(400)
        .json({ success: false, message: "supplierId and items required" });
    let subtotal = 0;
    for (const item of items)
      subtotal += Number(item.quantity) * Number(item.unitPrice);
    const total = subtotal;
    const { rows: countRows } = await q(
      "SELECT COUNT(*) FROM marketplace_orders WHERE company_id=$1",
      [req.user.companyId],
    );
    const orderNumber = `MKT-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;
    const { rows: orderRows } = await q(
      `INSERT INTO marketplace_orders
     (order_number, company_id, supplier_id, project_id, subtotal, delivery_fee, total,
      delivery_address, delivery_lat, delivery_lng, notes, expected_delivery_date, created_by_id)
     VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        orderNumber,
        req.user.companyId,
        supplierId,
        projectId || null,
        subtotal,
        deliveryAddress || null,
        deliveryLat || null,
        deliveryLng || null,
        notes || null,
        expectedDeliveryDate || null,
        req.user.userId,
      ],
    );
    const order = orderRows[0];
    for (const item of items) {
      await q(
        `INSERT INTO marketplace_order_items (order_id, product_id, product_name, unit, quantity, unit_price, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.id,
          item.productId,
          item.productName,
          item.unit,
          item.quantity,
          item.unitPrice,
          Number(item.quantity) * Number(item.unitPrice),
        ],
      );
    }
    const { rows: supplierRows } = await q(
      "SELECT sp.*, u.email FROM supplier_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.id=$1",
      [supplierId],
    );
    res.status(201).json({
      success: true,
      data: {
        ...order,
        whatsappUrl: supplierRows[0]?.whatsapp
          ? `https://wa.me/${supplierRows[0].whatsapp.replace(/[^0-9]/g, "")}`
          : null,
      },
    });
  }),
);

router.get(
  "/orders",
  protect,
  asyncHandler(async (req, res) => {
    const { status, role } = req.query;
    let whereClause = "";
    let params = [];
    if (role === "supplier") {
      const { rows: supplier } = await q(
        "SELECT id FROM supplier_profiles WHERE user_id=$1",
        [req.user.userId],
      );
      if (!supplier[0]) return res.json({ success: true, data: [] });
      whereClause = "mo.supplier_id = $1";
      params = [supplier[0].id];
    } else {
      whereClause = "mo.company_id = $1";
      params = [req.user.companyId];
    }
    if (status) {
      whereClause += ` AND mo.status = $${params.length + 1}`;
      params.push(status);
    }
    const { rows } = await q(
      `SELECT mo.*,
      sp.business_name AS supplier_name, sp.whatsapp AS supplier_whatsapp,
      sp.city AS supplier_city, sp.phone AS supplier_phone,
      c.name AS company_name,
      (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
     FROM marketplace_orders mo
     JOIN supplier_profiles sp ON sp.id = mo.supplier_id
     JOIN companies c ON c.id = mo.company_id
     WHERE ${whereClause}
     ORDER BY mo.created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.patch(
  "/orders/:id/status",
  protect,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const validStatuses = [
      "CONFIRMED",
      "PREPARING",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
    ];
    if (!validStatuses.includes(status))
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    const updates = ["status = $1", "updated_at = NOW()"];
    const params = [status];
    if (status === "DELIVERED") updates.push(`delivered_at = NOW()`);
    if (status === "CONFIRMED") updates.push(`confirmed_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await q(
      `UPDATE marketplace_orders SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    res.json({ success: true, data: rows[0] });
  }),
);

router.patch(
  "/orders/:id/confirm-delivery",
  protect,
  asyncHandler(async (req, res) => {
    const { emitOrderUpdate } = require("../services/socket.service");
    const { rows: orderRows } = await q(
      `SELECT mo.*, et.supplier_amount, et.id AS escrow_tx_id
     FROM marketplace_orders mo
     LEFT JOIN escrow_transactions et ON et.id = mo.escrow_id
     WHERE mo.id = $1 AND mo.company_id = $2`,
      [req.params.id, req.user.companyId],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (orderRows[0].status !== "OUT_FOR_DELIVERY") {
      return res
        .status(400)
        .json({ success: false, message: "Order is not out for delivery" });
    }
    const { rows } = await q(
      `UPDATE marketplace_orders SET
      status = 'DELIVERED', delivered_at = NOW(), delivery_confirmed_at = NOW(),
      delivery_confirmed_by = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.id],
    );
    emitOrderUpdate(req.app, {
      order: rows[0],
      companyId: req.user.companyId,
      supplierId: orderRows[0].supplier_id,
    });
    res.json({
      success: true,
      data: rows[0],
      message:
        "Delivery confirmed. Payment will be released by Projex admin shortly.",
    });
  }),
);

router.patch(
  "/orders/:id/cancel",
  protect,
  asyncHandler(async (req, res) => {
    const {
      emitOrderUpdate,
      emitPaymentUpdate,
    } = require("../services/socket.service");
    const { reason } = req.body;
    const { rows: orderRows } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1 AND (company_id=$2 OR $3=TRUE)",
      [
        req.params.id,
        req.user.companyId,
        req.user.role === "SUPER_ADMIN_PROJEX",
      ],
    );
    if (!orderRows[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    const order = orderRows[0];
    if (["DELIVERED", "CANCELLED"].includes(order.status)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot cancel this order" });
    }
    const { rows } = await q(
      "UPDATE marketplace_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (order.escrow_id && order.payment_status === "PAID") {
      await q(
        `UPDATE escrow_transactions SET status = 'REFUNDED', refunded_at = NOW(), notes = $1, updated_at = NOW() WHERE id = $2`,
        [reason || "Order cancelled", order.escrow_id],
      );
      emitPaymentUpdate(req.app, {
        companyId: order.company_id,
        supplierId: order.supplier_id,
        payment: {
          orderId: order.id,
          orderNumber: order.order_number,
          amount: order.total,
          status: "REFUNDED",
          message: "Payment refunded to company",
        },
      });
    }
    emitOrderUpdate(req.app, {
      order: rows[0],
      companyId: order.company_id,
      supplierId: order.supplier_id,
    });
    res.json({
      success: true,
      data: rows[0],
      message: "Order cancelled. Payment will be refunded.",
    });
  }),
);

router.post(
  "/orders/:id/review",
  protect,
  asyncHandler(async (req, res) => {
    const { rating, review } = req.body;
    const { rows: order } = await q(
      "SELECT * FROM marketplace_orders WHERE id=$1 AND company_id=$2",
      [req.params.id, req.user.companyId],
    );
    if (!order[0])
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    const { rows } = await q(
      `INSERT INTO supplier_reviews (supplier_id, company_id, order_id, rating, review) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        order[0].supplier_id,
        req.user.companyId,
        req.params.id,
        rating,
        review || null,
      ],
    );
    await q(
      `UPDATE supplier_profiles SET
      rating = (SELECT AVG(rating) FROM supplier_reviews WHERE supplier_id = $1),
      total_reviews = (SELECT COUNT(*) FROM supplier_reviews WHERE supplier_id = $1), updated_at = NOW()
     WHERE id = $1`,
      [order[0].supplier_id],
    );
    res.status(201).json({ success: true, data: rows[0] });
  }),
);

// ── FEATURED PLACEMENTS ───────────────────────────────────────
router.post(
  "/supplier/featured/initialize",
  protect,
  asyncHandler(async (req, res) => {
    const { type, productId, autoRenew } = req.body;
    if (!["STORE", "PRODUCT"].includes(type)) throw new Error("Invalid type");
    if (type === "PRODUCT" && !productId)
      throw new Error("productId required for PRODUCT type");
    const { rows: spRows } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    if (!spRows.length) throw new Error("Supplier profile not found");
    const supplierId = spRows[0].id;
    const priceKey =
      type === "STORE"
        ? "featured_store_price_monthly"
        : "featured_product_price_weekly";
    const { rows: priceRows } = await q(
      "SELECT value FROM platform_settings WHERE key = $1",
      [priceKey],
    );
    const amount = parseInt(
      priceRows[0]?.value || (type === "STORE" ? "15000" : "5000"),
    );
    const durationDays = type === "STORE" ? 30 : 7;
    const { rows: existing } = await q(
      `SELECT id FROM featured_placements WHERE supplier_id = $1 AND type = $2 AND is_active = true AND ends_at > NOW() AND ($3::uuid IS NULL OR product_id = $3)`,
      [supplierId, type, productId || null],
    );
    if (existing.length)
      throw new Error(`You already have an active ${type} placement`);
    const { rows: userRows } = await q(
      "SELECT email FROM users WHERE id = $1",
      [req.user.userId],
    );
    const reference = `feat_${type.toLowerCase()}_${supplierId}_${Date.now()}`;
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userRows[0].email,
          amount: amount * 100,
          reference,
          metadata: {
            type,
            supplierId,
            productId: productId || null,
            autoRenew: autoRenew || false,
            durationDays,
            featurePlacement: true,
          },
          callback_url: `${process.env.FRONTEND_URL}/supplier/featured/verify`,
        }),
      },
    );
    const paystackData = await paystackRes.json();
    if (!paystackData.status) throw new Error("Payment initialization failed");
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const { rows: placementRows } = await q(
      `INSERT INTO featured_placements (type, supplier_id, product_id, starts_at, ends_at, duration_days, amount_paid, payment_reference, payment_status, auto_renew, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, false) RETURNING *`,
      [
        type,
        supplierId,
        productId || null,
        now,
        endsAt,
        durationDays,
        amount,
        reference,
        autoRenew || false,
      ],
    );
    const placement = placementRows[0];
    await q(
      `INSERT INTO featured_placement_payments (featured_placement_id, supplier_id, paystack_ref, amount, status, period_start, period_end) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)`,
      [placement.id, supplierId, reference, amount, now, endsAt],
    );
    res.json({
      success: true,
      data: {
        authorizationUrl: paystackData.data.authorization_url,
        reference,
        amount,
        placementId: placement.id,
      },
    });
  }),
);

router.post(
  "/supplier/featured/verify",
  protect,
  asyncHandler(async (req, res) => {
    const { reference } = req.body;
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );
    const paystackData = await paystackRes.json();
    if (!paystackData.status || paystackData.data.status !== "success")
      throw new Error("Payment verification failed");
    const authCode =
      paystackData.data.authorization?.authorization_code || null;
    const { rows: placementRows } = await q(
      `UPDATE featured_placements SET payment_status = 'SUCCESS', paystack_authorization_code = $1, is_active = true, updated_at = NOW() WHERE payment_reference = $2 RETURNING *`,
      [authCode, reference],
    );
    if (!placementRows.length) throw new Error("Placement not found");
    const placement = placementRows[0];
    await q(
      `UPDATE featured_placement_payments SET status = 'SUCCESS', paystack_authorization_code = $1, paid_at = NOW() WHERE paystack_ref = $2`,
      [authCode, reference],
    );
    if (placement.product_id) {
      await q("UPDATE supplier_products SET is_featured = true WHERE id = $1", [
        placement.product_id,
      ]);
    }
    res.json({
      success: true,
      data: placement,
      message: "Placement activated successfully",
    });
  }),
);

router.get(
  "/supplier/featured",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: spRows } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    if (!spRows.length) throw new Error("Supplier not found");
    const { rows } = await q(
      `SELECT fp.*, fpp.paid_at, fpp.amount AS last_payment_amount
     FROM featured_placements fp
     LEFT JOIN featured_placement_payments fpp ON fpp.featured_placement_id = fp.id AND fpp.status = 'SUCCESS'
     WHERE fp.supplier_id = $1
     ORDER BY fp.created_at DESC`,
      [spRows[0].id],
    );
    res.json({ success: true, data: rows });
  }),
);

router.put(
  "/supplier/featured/:placementId/cancel",
  protect,
  asyncHandler(async (req, res) => {
    const { rows: spRows } = await q(
      "SELECT id FROM supplier_profiles WHERE user_id = $1",
      [req.user.userId],
    );
    const { rows } = await q(
      `UPDATE featured_placements SET auto_renew = false, cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND supplier_id = $2 RETURNING *`,
      [req.params.placementId, spRows[0]?.id],
    );
    if (!rows.length) throw new Error("Placement not found");
    res.json({
      success: true,
      message: "Auto-renew cancelled. Placement runs until expiry.",
    });
  }),
);

// ── MARKETPLACE PAYMENT ───────────────────────────────────────
router.post(
  "/billing/marketplace/initialize",
  protect,
  asyncHandler(async (req, res) => {
    const { amount, email, metadata } = req.body;
    if (!amount || !email)
      return res
        .status(400)
        .json({ success: false, message: "amount and email required" });
    const ref = `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let authUrl = null;
    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              amount: Math.round(amount * 100),
              reference: ref,
              currency: "NGN",
              metadata: {
                ...metadata,
                type: "MARKETPLACE",
                companyId: req.user.companyId,
              },
            }),
          },
        );
        const data = await r.json();
        if (data.status) authUrl = data.data.authorization_url;
      } catch (e) {
        console.warn("Paystack marketplace init failed:", e.message);
      }
    }
    res.json({
      success: true,
      data: {
        authorizationUrl:
          authUrl || `https://paystack.com/pay/projex-marketplace`,
        reference: ref,
        amount,
      },
    });
  }),
);

router.post(
  "/billing/marketplace/verify",
  protect,
  asyncHandler(async (req, res) => {
    const { reference, orders } = req.body;
    let verified = false;
    if (
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_SECRET_KEY !== "your_paystack_secret_key"
    ) {
      try {
        const r = await fetch(
          `https://api.paystack.co/transaction/verify/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );
        const paystackData = await r.json();
        verified =
          paystackData.status && paystackData.data?.status === "success";
      } catch (e) {
        console.warn("Paystack marketplace verify failed:", e.message);
      }
    } else {
      verified = true;
    }
    if (!verified)
      return res
        .status(400)
        .json({ success: false, message: "Payment not verified" });

    const { rows: existingOrders } = await q(
      `SELECT mo.*, sp.business_name AS supplier_name, sp.whatsapp AS supplier_whatsapp,
        c.name AS company_name,
        (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items
       FROM marketplace_orders mo
       JOIN supplier_profiles sp ON sp.id = mo.supplier_id
       JOIN companies c ON c.id = mo.company_id
       WHERE mo.payment_reference = $1`,
      [reference],
    );
    if (existingOrders.length > 0)
      return res.json({
        success: true,
        data: { orders: existingOrders, reference },
        message: "Order already processed",
      });

    const { emitNewOrder } = require("../services/socket.service");
    const createdOrders = [];

    for (const group of orders) {
      const subtotal = group.items.reduce(
        (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
        0,
      );
      const { rows: commRows } = await q(
        "SELECT * FROM commission_settings LIMIT 1",
      );
      const settings = commRows[0] || { global_rate: 3, minimum_amount: 500 };
      const { rows: supRows } = await q(
        "SELECT custom_commission_rate FROM supplier_profiles WHERE id = $1",
        [group.supplierId],
      );
      const rate = supRows[0]?.custom_commission_rate ?? settings.global_rate;
      const commissionAmount = Math.max(
        (subtotal * rate) / 100,
        settings.minimum_amount,
      );
      const supplierAmount = subtotal - commissionAmount;
      const { rows: supplierRows } = await q(
        "SELECT id FROM supplier_profiles WHERE id = $1",
        [group.supplierId],
      );
      if (!supplierRows[0]) continue;
      const { rows: countRows } = await q(
        "SELECT COUNT(*) FROM marketplace_orders WHERE company_id = $1",
        [req.user.companyId],
      );
      const orderNumber = `MKT-${String(parseInt(countRows[0].count) + 1).padStart(4, "0")}`;
      const { rows: escrowRows } = await q(
        `INSERT INTO escrow_transactions (order_id, company_id, supplier_id, amount, commission_rate, commission_amount, supplier_amount, status, paystack_reference, held_at) VALUES (NULL, $1, $2, $3, $4, $5, $6, 'HOLDING', $7, NOW()) RETURNING *`,
        [
          req.user.companyId,
          supplierRows[0].id,
          subtotal,
          rate,
          commissionAmount,
          supplierAmount,
          reference,
        ],
      );
      const escrow = escrowRows[0];
      const { rows: orderRows } = await q(
        `INSERT INTO marketplace_orders (order_number, company_id, supplier_id, project_id, subtotal, delivery_fee, total, delivery_address, notes, payment_status, payment_reference, escrow_id, status, created_by_id) VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,'PAID',$8,$9,'CONFIRMED',$10) RETURNING *`,
        [
          orderNumber,
          req.user.companyId,
          supplierRows[0].id,
          group.projectId || null,
          subtotal,
          group.deliveryAddress || null,
          group.notes || null,
          reference,
          escrow.id,
          req.user.userId,
        ],
      );
      const order = orderRows[0];
      await q("UPDATE escrow_transactions SET order_id = $1 WHERE id = $2", [
        order.id,
        escrow.id,
      ]);
      for (const item of group.items) {
        await q(
          `INSERT INTO marketplace_order_items (order_id, product_id, product_name, unit, quantity, unit_price, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            order.id,
            item.productId,
            item.productName,
            item.unit,
            item.quantity,
            item.unitPrice,
            Number(item.quantity) * Number(item.unitPrice),
          ],
        );
      }
      const { rows: fullOrder } = await q(
        `SELECT mo.*, sp.business_name AS supplier_name, sp.whatsapp AS supplier_whatsapp, c.name AS company_name, (SELECT json_agg(i.*) FROM marketplace_order_items i WHERE i.order_id = mo.id) AS items FROM marketplace_orders mo JOIN supplier_profiles sp ON sp.id = mo.supplier_id JOIN companies c ON c.id = mo.company_id WHERE mo.id = $1`,
        [order.id],
      );
      emitNewOrder(req.app, {
        order: fullOrder[0],
        supplierId: supplierRows[0].id,
        companyId: req.user.companyId,
      });
      createdOrders.push(fullOrder[0]);
    }
    res.json({ success: true, data: { orders: createdOrders, reference } });
  }),
);

// ── ADS ────────────────────────────────────────────────────────
router.get(
  "/ads",
  asyncHandler(async (req, res) => {
    const { placement } = req.query;
    const conds = ["is_active = TRUE", "starts_at <= NOW()", "ends_at > NOW()"];
    const params = [];
    if (placement) {
      params.push(placement);
      conds.push(`placement = $${params.length}`);
    }
    const { rows } = await q(
      `SELECT id, title, description, image_url, link_url, placement, advertiser_name FROM advertisements WHERE ${conds.join(" AND ")} ORDER BY amount_paid DESC, created_at DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

router.post(
  "/ads/:id/impression",
  asyncHandler(async (req, res) => {
    await q(
      "UPDATE advertisements SET impressions = impressions + 1 WHERE id = $1",
      [req.params.id],
    );
    res.json({ success: true });
  }),
);

router.post(
  "/ads/:id/click",
  asyncHandler(async (req, res) => {
    await q("UPDATE advertisements SET clicks = clicks + 1 WHERE id = $1", [
      req.params.id,
    ]);
    res.json({ success: true });
  }),
);

router.get(
  "/settings/featured-pricing",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT key, value FROM platform_settings WHERE key IN ('featured_store_price_monthly', 'featured_product_price_weekly')",
    );
    const pricing = {};
    rows.forEach((r) => {
      pricing[r.key] = parseInt(r.value);
    });
    res.json({ success: true, data: pricing });
  }),
);

// ── PLANS (public) ─────────────────────────────────────────────
router.get(
  "/plans",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      "SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC",
    );
    const plans = rows.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency,
      interval: p.interval,
      description: p.description,
      maxProjects: p.max_projects,
      maxUsers: p.max_users,
      features: p.features,
      isFree: p.is_free,
      isPopular: p.is_popular,
    }));
    res.json({ success: true, data: plans });
  }),
);

module.exports = router;
