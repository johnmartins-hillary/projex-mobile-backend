const { asyncHandler } = require("../middleware");
const { companyRepo, billingRepo } = require("../repositories");
const { AppError } = require("../utils/errors");
const { sendEmail, emailTemplates } = require("../services/email.service");
const { query } = require("../config/database");
const { logger } = require("../utils/logger");

const PLAN_PRICES = { STARTER: 5000, PRO: 15000, ENTERPRISE: 40000 };
const PLAN_LIMITS = {
  STARTER: { maxProjects: 2, maxUsers: 5 },
  PRO: { maxProjects: 10, maxUsers: 25 },
  ENTERPRISE: { maxProjects: 999, maxUsers: 999 },
};

exports.billing = {
  getSubscription: asyncHandler(async (req, res) => {
    const sub = await billingRepo.getSubscription(req.user.companyId);
    const company = await companyRepo.findById(req.user.companyId);
    res.json({ success: true, data: { subscription: sub, company } });
  }),

  initialize: asyncHandler(async (req, res) => {
    const { plan, email } = req.body;
    if (!PLAN_PRICES[plan]) throw new AppError("Invalid plan", 400);
    const amount = PLAN_PRICES[plan] * 100; // kobo
    const ref = `projex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let authUrl = `https://paystack.com/pay/projex-${plan.toLowerCase()}`;
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
              amount,
              reference: ref,
              currency: "NGN",
              metadata: { plan, companyId: req.user.companyId },
            }),
          },
        );
        const data = await r.json();
        if (data.status) authUrl = data.data.authorization_url;
      } catch (e) {
        logger.warn("Paystack init failed:", e.message);
      }
    }

    await billingRepo.createSubscription({
      companyId: req.user.companyId,
      plan,
      paystackRef: ref,
      amount: PLAN_PRICES[plan],
    });
    res.json({
      success: true,
      data: {
        authorizationUrl: authUrl,
        reference: ref,
        plan,
        amount: PLAN_PRICES[plan],
      },
    });
  }),

  verify: asyncHandler(async (req, res) => {
    const { reference } = req.body;
    let verified = false;
    let paystackData = null;

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
        paystackData = await r.json();
        verified =
          paystackData.status && paystackData.data?.status === "success";
      } catch (e) {
        logger.warn("Paystack verify failed:", e.message);
      }
    } else {
      verified = true; // dev mode - auto verify
    }

    if (!verified)
      throw new AppError("Payment not successful", 400, "PAYMENT_FAILED");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const sub = await billingRepo.activateSubscription(reference, {
      expiresAt,
      subCode: paystackData?.data?.subscription_code,
    });
    if (sub) {
      const limits = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.STARTER;
      await companyRepo.update(req.user.companyId, {
        plan: sub.plan,
        plan_expires_at: expiresAt,
        max_projects: limits.maxProjects,
        max_users: limits.maxUsers,
      });
      await billingRepo.recordPayment({
        companyId: req.user.companyId,
        subscriptionId: sub.id,
        paystackRef: reference,
        amount: sub.amount,
        status: "success",
        metadata: paystackData?.data,
      });
      try {
        const { rows: userRows } = await query(
          "SELECT u.first_name, u.email FROM users u WHERE u.company_id=$1 AND u.role IN ('SUPER_ADMIN','PROJECT_OWNER') ORDER BY u.created_at ASC LIMIT 1",
          [req.user.companyId],
        );
        if (userRows[0] && sub) {
          const template = emailTemplates.paymentConfirmation(
            userRows[0].first_name,
            sub.plan,
            sub.amount,
          );
          sendEmail({
            to: userRows[0].email,
            subject: template.subject,
            html: template.html,
          }).catch(() => {});
        }
      } catch (e) {
        logger.warn("Payment email failed:", e.message);
      }
    }
    res.json({ success: true, message: "Subscription activated", data: sub });
  }),

  webhook: asyncHandler(async (req, res) => {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
    if (secret) {
      const crypto = require("crypto");
      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (hash !== req.headers["x-paystack-signature"])
        return res.status(400).json({ success: false });
    }
    const { event, data } = req.body;
    if (event === "charge.success") {
      const ref = data.reference;
      const meta = data.metadata || {};
      if (meta.companyId && meta.plan) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await billingRepo
          .activateSubscription(ref, { expiresAt })
          .catch(() => {});
        const limits = PLAN_LIMITS[meta.plan] || PLAN_LIMITS.STARTER;
        await companyRepo
          .update(meta.companyId, {
            plan: meta.plan,
            plan_expires_at: expiresAt,
            ...limits,
          })
          .catch(() => {});
      }
    }
    res.json({ success: true });
  }),

  getHistory: asyncHandler(async (req, res) => {
    const history = await billingRepo.getPaymentHistory(req.user.companyId);
    res.json({ success: true, data: history });
  }),
};
