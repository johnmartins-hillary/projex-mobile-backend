const express = require("express");
const { protect, authorize, asyncHandler } = require("../middleware");

const router = express.Router();

// POST /sms/send
router.post(
  "/send",
  protect,
  asyncHandler(async (req, res) => {
    const { sendSMS, smsTemplates } = require("../services/sms.service");
    const { to, message, template, templateData } = req.body;
    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "Phone number required" });
    let smsMessage = message;
    if (template && smsTemplates[template]) {
      smsMessage = smsTemplates[template](...(templateData || []));
    }
    if (!smsMessage)
      return res
        .status(400)
        .json({ success: false, message: "Message required" });
    const sent = await sendSMS(to, smsMessage);
    res.json({ success: sent, message: sent ? "SMS sent" : "SMS failed" });
  }),
);

// POST /sms/bulk
router.post(
  "/bulk",
  protect,
  authorize("SUPER_ADMIN", "PROJECT_OWNER"),
  asyncHandler(async (req, res) => {
    const { sendBulkSMS } = require("../services/sms.service");
    const { recipients, message } = req.body;
    if (!recipients?.length || !message) {
      return res
        .status(400)
        .json({ success: false, message: "recipients and message required" });
    }
    const sent = await sendBulkSMS(recipients, message);
    res.json({ success: true, data: { sent, total: recipients.length } });
  }),
);

module.exports = router;
