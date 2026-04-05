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
  language: user.language,
  isEmailVerified: user.is_email_verified,
  company: company
    ? {
        id: company.id,
        name: company.name,
        plan: company.plan,
        logoUrl: company.logo_url,
        primaryColor: company.primary_color || "#FF6A00",
        secondaryColor: company.secondary_color || "#0A2342",
        tagline: company.tagline || null,
        maxProjects: company.max_projects,
        maxUsers: company.max_users,
        planExpiresAt: company.plan_expires_at,
      }
    : undefined,
});

const register = async ({
  firstName,
  lastName,
  email,
  phone,
  password,
  companyName,
  role,
}) => {
  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ConflictError("Email already registered");

  const company = await companyRepo.create({ name: companyName, email, phone });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await userRepo.create({
    companyId: company.id,
    firstName,
    lastName,
    email,
    phone,
    passwordHash,
    role: role || "PROJECT_OWNER",
  });

  const tokens = generateTokens(user);
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  sendEmail({
    to: email,
    template: "welcome",
    data: { firstName, companyName },
  }).catch((e) => logger.error("Welcome email:", e.message));

  return { ...tokens, user: formatUser(user, company) };
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
  if (!user) return; // silent — don't expose email existence
  const token = uuidv4();
  const exp = new Date(Date.now() + 3600000);
  await userRepo.updateResetToken(user.id, token, exp);
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    template: "resetPassword",
    data: { firstName: user.first_name, resetUrl },
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
