const { asyncHandler } = require("../middleware");
const { userRepo, companyRepo } = require("../repositories");
const { NotFoundError } = require("../utils/errors");
const authService = require("../services/auth.service");
const { sendEmail, emailTemplates } = require("../services/email.service");

exports.auth = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    if (result) {
      const template = emailTemplates.welcome(
        result.user.firstName,
        result.user.company?.name || req.body.companyName,
        "STARTER",
      );
      sendEmail({
        to: result.user.email,
        subject: template.subject,
        html: template.html,
      }).catch(() => {});
    }
    res
      .status(201)
      .json({ success: true, message: "Account created", data: result });
  }),

  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json({ success: true, message: "Login successful", data: result });
  }),

  refresh: asyncHandler(async (req, res) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.json({ success: true, data: tokens });
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.user.userId);
    res.json({ success: true, message: "Logged out" });
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email);
    res.json({
      success: true,
      message: "If that email exists, a reset link was sent.",
    });
  }),

  resetPassword: asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, message: "Password reset successfully." });
  }),

  getMe: asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.user.userId);
    if (!user) throw new NotFoundError("User");
    const company = await companyRepo.findById(user.company_id);
    res.json({ success: true, data: authService.formatUser(user, company) });
  }),

  updatePushToken: asyncHandler(async (req, res) => {
    await userRepo.updatePushToken(req.user.userId, req.body.pushToken);
    res.json({ success: true });
  }),
};
