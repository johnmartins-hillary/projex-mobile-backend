// ── services/auth.service.js ─────────────────────────────────
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { userRepo, companyRepo } = require("../repositories");
const { sendEmail } = require("./index");
const {
  ConflictError,
  UnauthorizedError,
  AppError,
} = require("../utils/errors");
const { logger } = require("../utils/logger");

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });
const signRefresh = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  });

const buildTokenPayload = (user) => ({
  userId: user.id,
  companyId: user.company_id,
  role: user.role,
});

const generateTokens = (user) => ({
  accessToken: sign(buildTokenPayload(user)),
  refreshToken: signRefresh(buildTokenPayload(user)),
});

const formatUser = (user, company) => ({
  id: user.id,
  firstName: user.first_name,
  lastName: user.last_name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  avatarUrl: user.avatar_url,
  accountType: user.role === "SUPPLIER" ? "SUPPLIER" : "COMPANY",
  company: company
    ? {
        id: company.id,
        name: company.name,
        plan: company.plan,
        maxProjects: company.max_projects,
        maxUsers: company.max_users,
        logoUrl: company.logo_url,
        primaryColor: company.primary_color,
        secondaryColor: company.secondary_color,
        tagline: company.tagline,
      }
    : null,
});
const register = async (data) => {
  const existing = await userRepo.findByEmail(data.email);
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await bcrypt.hash(data.password, 12);

  // SUPPLIER signup — no company needed
  if (data.accountType === "SUPPLIER") {
    const user = await userRepo.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone || null,
      passwordHash,
      role: "SUPPLIER",
      companyId: null,
    });

    const tokens = generateTokens(user);
    await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

    // Send welcome email
    const { sendEmail } = require("./email.service");
    const { emailTemplates } = require("./email.service");
    sendEmail({
      to: user.email,
      subject: "Welcome to Projex Marketplace!",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#0A2342;padding:32px;border-bottom:4px solid #FF6A00">
            <h1 style="color:white;margin:0">🏪 Welcome to Projex Marketplace!</h1>
          </div>
          <div style="padding:32px">
            <p>Hi ${data.firstName},</p>
            <p>Your supplier account has been created. Start listing your products to reach thousands of construction companies across Nigeria.</p>
            <p><strong>Next steps:</strong></p>
            <ol>
              <li>Complete your supplier profile</li>
              <li>Add your products with prices</li>
              <li>Start receiving orders!</li>
            </ol>
            <p><strong>The Projex Team</strong></p>
          </div>
        </div>
      `,
    }).catch(() => {});

    return { ...tokens, user: formatUser(user, null), accountType: "SUPPLIER" };
  }

  // CONSTRUCTION COMPANY signup
  const company = await companyRepo.create({
    name: data.companyName,
    email: data.email,
    phone: data.phone || null,
    plan: "STARTER",
    maxProjects: 2,
    maxUsers: 5,
  });

  const user = await userRepo.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone || null,
    passwordHash,
    role: data.role || "PROJECT_OWNER",
    companyId: company.id,
  });

  const tokens = generateTokens(user);
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  // Send welcome email
  const { sendEmail, emailTemplates } = require("./email.service");
  const template = emailTemplates.welcome(
    user.first_name,
    company.name,
    "STARTER",
  );
  sendEmail({
    to: user.email,
    subject: template.subject,
    html: template.html,
  }).catch(() => {});

  return { ...tokens, user: formatUser(user, company), accountType: "COMPANY" };
};

const login = async ({ email, password }) => {
  const user = await userRepo.findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new UnauthorizedError("Invalid email or password");
  }
  if (!user.is_active)
    throw new UnauthorizedError("Account deactivated. Contact your admin.");

  const company = await companyRepo.findById(user.company_id);
  const tokens = generateTokens(user);
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, user: formatUser(user, company) };
};

const refresh = async (refreshToken) => {
  if (!refreshToken) throw new UnauthorizedError("Refresh token required");
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const user = await userRepo.findById(decoded.userId);
  if (!user || user.refresh_token !== refreshToken)
    throw new UnauthorizedError("Refresh token revoked");

  const tokens = generateTokens(user);
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);
  return tokens;
};

const logout = async (userId) => {
  await userRepo.updateRefreshToken(userId, null);
};

const forgotPassword = async (email) => {
  const user = await userRepo.findByEmail(email);
  if (!user) return;

  // Generate 6-digit OTP
  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const exp = new Date(Date.now() + 3600000); // 1 hour
  await userRepo.updateResetToken(user.id, token, exp);

  const { sendEmail } = require("./email.service");

  await sendEmail({
    to: email,
    subject: "Your Projex Password Reset OTP",
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
          .otp-box { background: #0A2342; border-radius: 12px; padding: 24px; margin: 20px 0; text-align: center; }
          .otp { font-size: 42px; font-weight: 800; color: #FF6A00; letter-spacing: 8px; }
          .expire { font-size: 12px; color: #7F8C8D; margin-top: 8px; }
          .footer { background: #F4F6FA; padding: 20px 40px; font-size: 12px; color: #7F8C8D; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="brand">🏗️ Pro<span>jex</span></div>
          </div>
          <div class="content">
            <p class="text">Hi ${user.first_name},</p>
            <p class="text">Use this OTP to reset your Projex password:</p>
            <div class="otp-box">
              <div class="otp">${token}</div>
            </div>
            <p class="expire" style="text-align:center">⏰ Expires in 1 hour</p>
            <p class="text" style="margin-top:16px">Enter this code in the app to reset your password.</p>
            <p class="text">If you didn't request this, ignore this email.</p>
            <p class="text"><strong>The Projex Team</strong></p>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} Projex · Smart Construction Management
          </div>
        </div>
      </body>
      </html>
    `,
  });
};
const resetPassword = async (token, password) => {
  const user = await userRepo.findByResetToken(token);
  if (!user) throw new AppError("Reset token is invalid or expired", 400);
  const passwordHash = await bcrypt.hash(password, 12);
  await userRepo.updatePassword(user.id, passwordHash);
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  formatUser,
};
