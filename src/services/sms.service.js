const { logger } = require("../utils/logger");

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "AKSHTOUR";
const TERMII_BASE_URL = "https://api.ng.termii.com/api";

const formatPhone = (phone) => {
  if (!phone) return null;
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, "");
  // Convert 0XXXXXXXXXX to 234XXXXXXXXXX
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  // Add 234 if starts with 7, 8, 9
  if (cleaned.length === 10) cleaned = "234" + cleaned;
  return cleaned;
};

const sendSMS = async (to, message) => {
  try {
    if (!TERMII_API_KEY) {
      logger.warn("TERMII_API_KEY not set — SMS not sent");
      return false;
    }

    const phone = formatPhone(to);
    if (!phone) {
      logger.warn("Invalid phone number:", to);
      return false;
    }

    const response = await fetch(`${TERMII_BASE_URL}/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: phone,
        from: TERMII_SENDER_ID,
        sms: message,
        type: "plain",
        api_key: TERMII_API_KEY,
        channel: "generic",
      }),
    });

    const result = await response.json();

    if (result.code === "ok" || result.message_id) {
      logger.info(`SMS sent to ${phone}: ${message.slice(0, 30)}...`);
      return true;
    } else {
      logger.warn("SMS failed:", result.message || JSON.stringify(result));
      return false;
    }
  } catch (e) {
    logger.error("SMS error:", e.message);
    return false;
  }
};

const sendBulkSMS = async (recipients, message) => {
  const results = await Promise.allSettled(
    recipients.map((phone) => sendSMS(phone, message)),
  );
  const sent = results.filter(
    (r) => r.status === "fulfilled" && r.value,
  ).length;
  logger.info(`Bulk SMS: ${sent}/${recipients.length} sent`);
  return sent;
};

// SMS Templates
const smsTemplates = {
  stockAlert: (materialName, quantity, unit, projectName) =>
    `PROJEX ALERT: ${materialName} stock is critically low. Only ${quantity} ${unit} remaining at ${projectName}. Reorder immediately.`,

  budgetAlert: (category, pct, projectName) =>
    `PROJEX ALERT: ${category} budget at ${pct}% for ${projectName}. Review spending immediately.`,

  expenseApproval: (amount, description, submittedBy) =>
    `PROJEX: Expense approval needed. ${submittedBy} submitted NGN ${Number(amount).toLocaleString()} for ${description}. Login to approve.`,

  maintenanceAlert: (equipmentName, scheduledDate) =>
    `PROJEX: Maintenance due for ${equipmentName} on ${scheduledDate}. Please schedule service.`,

  paymentConfirm: (amount, companyName) =>
    `PROJEX: Payment of NGN ${Number(amount).toLocaleString()} confirmed to ${companyName}. Check app for details.`,

  visitorAlert: (visitorName, purpose, projectName) =>
    `PROJEX: ${visitorName} checked in at ${projectName} for ${purpose}.`,

  weeklyReport: (projectName, totalSpent, budgetPct) =>
    `PROJEX Weekly: ${projectName} - Spent NGN ${Number(totalSpent).toLocaleString()} (${budgetPct}% of budget). Login for full report.`,
};

module.exports = { sendSMS, sendBulkSMS, smsTemplates, formatPhone };
