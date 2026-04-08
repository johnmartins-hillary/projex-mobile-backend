const emitOrderUpdate = (app, data) => {
  const io = app.get("io");
  if (!io) return;

  const { order, companyId, supplierId } = data;

  // Emit to company
  if (companyId) {
    io.to(`company:${companyId}`).emit("order:updated", order);
  }

  // Emit to supplier
  if (supplierId) {
    io.to(`supplier:${supplierId}`).emit("order:updated", order);
  }

  // Emit to admin
  io.to("admin").emit("order:updated", order);
};

const emitPaymentUpdate = (app, data) => {
  const io = app.get("io");
  if (!io) return;
  const { companyId, supplierId, payment } = data;
  if (companyId) io.to(`company:${companyId}`).emit("payment:updated", payment);
  if (supplierId)
    io.to(`supplier:${supplierId}`).emit("payment:updated", payment);
  io.to("admin").emit("payment:updated", payment);
};

const emitNewOrder = (app, data) => {
  const io = app.get("io");
  if (!io) return;
  const { order, supplierId, companyId } = data;
  if (supplierId) io.to(`supplier:${supplierId}`).emit("order:new", order);
  if (companyId) io.to(`company:${companyId}`).emit("order:new", order);
  io.to("admin").emit("order:new", order);
};

const initiateSupplierPayout = async (
  supplierId,
  amount,
  orderNumber,
  reference,
) => {
  const { query: q } = require("../config/database");
  const { logger } = require("../utils/logger");

  const { rows } = await q(
    `SELECT paystack_recipient_code, business_name, account_number, bank_name
     FROM supplier_profiles WHERE id = $1`,
    [supplierId],
  );

  const supplier = rows[0];
  if (!supplier) return { success: false, message: "Supplier not found" };

  if (!supplier.paystack_recipient_code) {
    logger.warn(
      `Supplier ${supplierId} has no recipient code — manual payout required`,
    );
    return {
      success: false,
      message: "Supplier has no bank details — manual payout required",
      manual: true,
    };
  }

  if (
    !process.env.PAYSTACK_SECRET_KEY ||
    process.env.PAYSTACK_SECRET_KEY === "your_paystack_secret_key"
  ) {
    logger.info(`DEV MODE: Skipping real transfer for ${orderNumber}`);
    return { success: true, transferCode: "DEV_TRANSFER", manual: false };
  }

  try {
    const r = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(amount * 100),
        recipient: supplier.paystack_recipient_code,
        reason: `Projex Order ${orderNumber} payout`,
        reference: `payout_${reference}_${Date.now()}`,
      }),
    });

    const data = await r.json();

    if (data.status) {
      logger.info(
        `Transfer initiated: ${data.data.transfer_code} for ${orderNumber}`,
      );
      return { success: true, transferCode: data.data.transfer_code };
    } else {
      // Handle specific Paystack errors
      logger.error(`Transfer failed for ${orderNumber}:`, data.message);

      // Starter business restriction
      if (data.message?.toLowerCase().includes("starter")) {
        return {
          success: false,
          message:
            "Paystack account needs upgrade to enable transfers. Contact Projex support.",
          manual: true, // Treat as manual payout needed
        };
      }

      // Insufficient balance
      if (
        data.message?.toLowerCase().includes("balance") ||
        data.message?.toLowerCase().includes("insufficient")
      ) {
        return {
          success: false,
          message:
            "Insufficient Paystack balance. Top up your Paystack account.",
          manual: true,
        };
      }

      return { success: false, message: data.message, manual: true };
    }
  } catch (e) {
    logger.error("Transfer error:", e.message);
    return { success: false, message: e.message, manual: true };
  }
};

module.exports = {
  emitOrderUpdate,
  emitPaymentUpdate,
  emitNewOrder,
  initiateSupplierPayout,
};
