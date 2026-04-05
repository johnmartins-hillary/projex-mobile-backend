const nodemailer = require("nodemailer");
const { logger } = require("../utils/logger");
const { sendSMS, smsTemplates } = require("./sms.service");

const transporter = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

const BRAND = { blue: "#0A2342", orange: "#FF6A00" };
const wrap = (
  body,
) => `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <div style="background:${BRAND.blue};padding:24px;border-bottom:4px solid ${BRAND.orange}">
    <span style="color:white;font-size:22px;font-weight:700">🏗️ Projex</span>
  </div>
  <div style="padding:24px">${body}</div>
  <div style="padding:12px 24px;background:#f4f6f7;font-size:11px;color:#888">Projex · Smart Construction Management · Nigeria</div>
</div>`;

const TEMPLATES = {
  welcome: (d) => ({
    subject: "Welcome to Projex!",
    html: wrap(
      `<h2>Welcome, ${d.firstName}!</h2><p>Your workspace for <strong>${d.companyName}</strong> is ready.</p>`,
    ),
  }),
  resetPassword: (d) => ({
    subject: "Projex — Password Reset",
    html: wrap(
      `<h2>Password Reset</h2><p>Hi ${d.firstName}, click below to reset your password.</p><a href="${d.resetUrl}">Reset Password →</a>`,
    ),
  }),
  lowStock: (d) => ({
    subject: `⚠️ Low Stock: ${d.materialName}`,
    html: wrap(
      `<p><strong>${d.status}: ${d.materialName}</strong></p><p>Current: ${d.quantity} ${d.unit}</p>`,
    ),
  }),
  budgetAlert: (d) => ({
    subject: `📊 Budget Alert: ${d.category} at ${d.pct}%`,
    html: wrap(
      `<h2>Budget Alert</h2><p>${d.category} budget has reached <strong>${d.pct}%</strong>.`,
    ),
  }),
};

const sendEmail = async ({ to, template, data, subject, html }) => {
  try {
    const tpl = template ? TEMPLATES[template]?.(data) : { subject, html };
    if (!tpl) throw new Error(`Unknown template: ${template}`);
    await transporter().sendMail({
      from: `"Projex" <${process.env.SMTP_USER}>`,
      to,
      ...tpl,
    });
    logger.info(`Email sent → ${to}`);
  } catch (err) {
    logger.error(`Email failed → ${to}:`, err.message);
  }
};

// ── Push notifications ────────────────────────────────────────
let firebaseApp;
const initFirebase = () => {
  if (!firebaseApp && process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const admin = require("firebase-admin");
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(
          JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
        ),
      });
      logger.info("✅ Firebase Admin initialized");
    } catch (e) {
      logger.warn("Firebase init failed:", e.message);
    }
  }
  return firebaseApp;
};

const sendPush = async (token, { title, body, data = {} }) => {
  const app = initFirebase();
  if (!app) return;
  try {
    const admin = require("firebase-admin");
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)]),
        ),
      },
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
  } catch (err) {
    logger.error("Push send failed:", err.message);
  }
};

const sendPushBulk = async (tokens, payload) => {
  for (const token of tokens) await sendPush(token, payload);
};

// ── Notifications ─────────────────────────────────────────────
const notifyCompanyAdmins = async (companyId, roles, notifData) => {
  try {
    const { notificationRepo, userRepo } = require("../repositories");
    const users = await userRepo.findByCompanyWithCount(companyId);
    const targets = users.filter((u) => roles.includes(u.role) && u.is_active);
    for (const user of targets) {
      await notificationRepo.create({ userId: user.id, ...notifData });
      if (user.push_token)
        sendPush(user.push_token, {
          title: notifData.title,
          body: notifData.body,
          data: notifData.data,
        }).catch(() => {});
    }
  } catch (e) {
    logger.error("notifyCompanyAdmins failed:", e.message);
  }
};

const notifyLowStock = async (material, status, companyId) => {
  await notifyCompanyAdmins(
    companyId,
    ["SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"],
    {
      title: `${status === "CRITICAL" ? "🚨 Critical" : "⚠️ Low"} Stock: ${material.name}`,
      body: `Only ${material.quantity} ${material.unit} remaining.`,
      type: "STOCK_ALERT",
      data: { materialId: material.id, status },
    },
  );

  // Send SMS to admins
  try {
    const { userRepo } = require("../repositories");
    const users = await userRepo.findByCompanyWithCount(companyId);
    const admins = users.filter(
      (u) => ["SUPER_ADMIN", "PROJECT_OWNER"].includes(u.role) && u.phone,
    );
    for (const admin of admins) {
      await sendSMS(
        admin.phone,
        smsTemplates.stockAlert(
          material.name,
          material.quantity,
          material.unit,
          "Site",
        ),
      );
    }
  } catch (e) {
    logger.error("SMS stock alert failed:", e.message);
  }
};

const notifyBudgetAlert = async (budget, pct, companyId) => {
  await notifyCompanyAdmins(
    companyId,
    ["SUPER_ADMIN", "PROJECT_OWNER", "ACCOUNTANT"],
    {
      title:
        pct >= 100
          ? `🚨 Budget Exceeded: ${budget.category}`
          : `⚠️ Budget Alert: ${budget.category}`,
      body: `${budget.category} is at ${pct}% utilisation.`,
      type: "BUDGET_ALERT",
      data: { budgetId: budget.id, pct },
    },
  );

  // Send SMS
  try {
    const { userRepo } = require("../repositories");
    const users = await userRepo.findByCompanyWithCount(companyId);
    const admins = users.filter(
      (u) => ["SUPER_ADMIN", "PROJECT_OWNER"].includes(u.role) && u.phone,
    );
    for (const admin of admins) {
      await sendSMS(
        admin.phone,
        smsTemplates.budgetAlert(budget.category, pct, "Project"),
      );
    }
  } catch (e) {
    logger.error("SMS budget alert failed:", e.message);
  }
};

const notifyMaintenance = async (equipment, companyId) => {
  await notifyCompanyAdmins(
    companyId,
    ["SUPER_ADMIN", "PROJECT_OWNER", "SITE_MANAGER"],
    {
      title: `🔧 Maintenance Due: ${equipment.name}`,
      body: `Service is due. Please schedule maintenance.`,
      type: "MAINTENANCE_ALERT",
      data: { equipmentId: equipment.id },
    },
  );
};

module.exports = {
  sendEmail,
  notifyLowStock,
  notifyBudgetAlert,
  notifyMaintenance,
  sendPush,
  sendPushBulk,
  notifyCompanyAdmins,
};
