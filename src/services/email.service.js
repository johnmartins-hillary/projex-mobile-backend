const nodemailer = require("nodemailer");
const { logger } = require("../utils/logger");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: true, // port 465 = SSL
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_TOKEN,
  },
});

const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_TOKEN) {
    logger.warn("Email not configured — skipping email send");
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"Projex" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });
    logger.info(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (e) {
    logger.error("Email send failed:", e.message);
    return false;
  }
};

const emailTemplates = {
  welcome: (firstName, companyName, plan) => ({
    subject: `Welcome to Projex, ${firstName}! 🏗️`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #2C3E50; margin: 0; padding: 0; background: #F4F6FA; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { background: #0A2342; padding: 32px 40px; border-bottom: 4px solid #FF6A00; }
          .brand { color: white; font-size: 24px; font-weight: 800; }
          .brand span { color: #FF6A00; }
          .content { padding: 32px 40px; }
          .greeting { font-size: 22px; font-weight: 700; color: #0A2342; margin-bottom: 12px; }
          .text { font-size: 14px; line-height: 1.6; color: #5D6D7E; margin-bottom: 16px; }
          .plan-badge { display: inline-block; background: #FF6A00; color: white; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 24px; }
          .features { background: #F4F6FA; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
          .feature { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 14px; color: #2C3E50; }
          .check { color: #27AE60; font-weight: 700; }
          .btn { display: inline-block; background: #FF6A00; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; }
          .footer { background: #F4F6FA; padding: 20px 40px; font-size: 12px; color: #7F8C8D; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="brand">🏗️ Pro<span>jex</span></div>
          </div>
          <div class="content">
            <div class="greeting">Welcome aboard, ${firstName}! 👋</div>
            <p class="text">
              Your account for <strong>${companyName}</strong> has been created successfully. 
              You're now on the <strong>${plan}</strong> plan.
            </p>
            <div class="plan-badge">${plan} Plan</div>
            <div class="features">
              <div class="feature"><span class="check">✓</span> Material & Inventory Tracking</div>
              <div class="feature"><span class="check">✓</span> Budget & Expense Management</div>
              <div class="feature"><span class="check">✓</span> Site Diary & Progress Photos</div>
              <div class="feature"><span class="check">✓</span> Employee & Attendance Management</div>
              <div class="feature"><span class="check">✓</span> Client Portal</div>
              <div class="feature"><span class="check">✓</span> Invoice Generator</div>
            </div>
            <p class="text">
              Download the Projex app on your phone and log in with your email and password to get started.
            </p>
            <p class="text">
              If you have any questions, reply to this email and we'll help you out.
            </p>
            <p class="text">Welcome to smarter construction management! 🚀</p>
            <p class="text"><strong>The Projex Team</strong></p>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} Projex · Smart Construction Management<br>
            You received this email because you created an account on Projex.
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  inviteTeamMember: (firstName, companyName, tempPassword, role) => ({
    subject: `You've been invited to join ${companyName} on Projex`,
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #2C3E50; margin: 0; padding: 0; background: #F4F6FA; }
        .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: #0A2342; padding: 32px 40px; border-bottom: 4px solid #FF6A00; }
        .brand { color: white; font-size: 24px; font-weight: 800; }
        .brand span { color: #FF6A00; }
        .content { padding: 32px 40px; }
        .text { font-size: 14px; line-height: 1.6; color: #5D6D7E; margin-bottom: 16px; }
        .creds { background: #0A2342; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .cred-label { color: rgba(255,255,255,0.6); font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        .cred-value { color: #FF6A00; font-size: 22px; font-weight: 800; letter-spacing: 2px; }
        .steps { background: #F4F6FA; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .step { display: flex; gap: 12px; margin-bottom: 12px; font-size: 14px; color: #2C3E50; align-items: flex-start; }
        .step-num { background: #FF6A00; color: white; width: 24px; height: 24px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0; }
        .footer { background: #F4F6FA; padding: 20px 40px; font-size: 12px; color: #7F8C8D; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="brand">🏗️ Pro<span>jex</span></div>
        </div>
        <div class="content">
          <p class="text">Hi ${firstName},</p>
          <p class="text">You've been invited to join <strong>${companyName}</strong> on Projex as a <strong>${role.replace(/_/g, " ")}</strong>.</p>
          
          <div class="creds">
            <div class="cred-label">Your Email</div>
            <div class="cred-value" style="font-size:16px;margin-bottom:16px">(the email this was sent to)</div>
            <div class="cred-label">Temporary Password</div>
            <div class="cred-value">${tempPassword}</div>
          </div>

          <div class="steps">
            <div class="step">
              <div class="step-num">1</div>
              <div>Download the <strong>Projex</strong> app on your phone</div>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <div>Tap <strong>Sign In</strong> — do NOT create a new account</div>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <div>Enter your email and the temporary password above</div>
            </div>
            <div class="step">
              <div class="step-num">4</div>
              <div>Go to <strong>Settings → Edit Profile</strong> to change your password</div>
            </div>
          </div>

          <p class="text">⚠️ <strong>Important:</strong> Do not create a new account. Use the Sign In button with the credentials above.</p>
          <p class="text"><strong>The Projex Team</strong></p>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} Projex · Smart Construction Management
        </div>
      </div>
    </body>
    </html>
  `,
  }),

  paymentConfirmation: (firstName, plan, amount) => ({
    subject: `Payment Confirmed — ${plan} Plan Activated 🎉`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #2C3E50; margin: 0; padding: 0; background: #F4F6FA; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; }
          .header { background: #0A2342; padding: 32px 40px; border-bottom: 4px solid #FF6A00; }
          .brand { color: white; font-size: 24px; font-weight: 800; }
          .brand span { color: #FF6A00; }
          .content { padding: 32px 40px; }
          .amount { font-size: 36px; font-weight: 800; color: #FF6A00; margin: 16px 0; }
          .text { font-size: 14px; line-height: 1.6; color: #5D6D7E; margin-bottom: 16px; }
          .footer { background: #F4F6FA; padding: 20px 40px; font-size: 12px; color: #7F8C8D; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="brand">🏗️ Pro<span>jex</span></div>
          </div>
          <div class="content">
            <p class="text">Hi ${firstName},</p>
            <p class="text">Your payment has been confirmed and your <strong>${plan}</strong> plan is now active!</p>
            <div class="amount">₦${Number(amount).toLocaleString("en-NG")}</div>
            <p class="text">Thank you for choosing Projex. Enjoy all the features of your ${plan} plan!</p>
            <p class="text"><strong>The Projex Team</strong></p>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} Projex · Smart Construction Management
          </div>
        </div>
      </body>
      </html>
    `,
  }),
};

module.exports = { sendEmail, emailTemplates };
