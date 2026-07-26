const { asyncHandler } = require("../middleware");
const { userRepo, companyRepo } = require("../repositories");
const {
  NotFoundError,
  AppError,
  PlanLimitError,
  ConflictError,
} = require("../utils/errors");
const { sendEmail, emailTemplates } = require("../services/email.service");
const bcrypt = require("bcryptjs");

exports.users = {
  getAll: asyncHandler(async (req, res) => {
    const users = await userRepo.findByCompanyWithCount(req.user.companyId);
    res.json({ success: true, data: users });
  }),

  invite: asyncHandler(async (req, res) => {
    const isSuperAdmin = req.user.role === "SUPER_ADMIN_PROJEX";

    if (!isSuperAdmin) {
      const company = await companyRepo.findById(req.user.companyId);
      const count = await userRepo.count({
        company_id: req.user.companyId,
        is_active: true,
      });
      if (count >= company.max_users)
        throw new PlanLimitError(
          `User limit reached (${company.max_users}). Upgrade plan.`,
        );
    }

    const existing = await userRepo.findByEmail(req.body.email);
    if (existing) throw new ConflictError("Email already registered");

    const tempPass = Math.random().toString(36).slice(-10) + "A1!";

    const user = await userRepo.create({
      firstName: req.body.firstName,
      lastName: req.body.lastName || "Admin",
      email: req.body.email,
      role: req.body.role,
      companyId: isSuperAdmin ? null : req.user.companyId,
      passwordHash: await bcrypt.hash(tempPass, 12),
    });

    if (!isSuperAdmin) {
      const company = await companyRepo.findById(req.user.companyId);
      const template = emailTemplates.inviteTeamMember(
        req.body.firstName || "Team Member",
        company.name || "your company",
        tempPass,
        req.body.role,
      );
      sendEmail({
        to: req.body.email,
        subject: template.subject,
        html: template.html,
      }).catch(() => {});
    } else {
      sendEmail({
        to: req.body.email,
        subject: "You've been invited as a Projex Admin",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#0A2342;padding:32px;border-bottom:4px solid #FF6A00">
              <h1 style="color:white;margin:0">Projex Admin Invitation</h1>
            </div>
            <div style="padding:32px">
              <p>Hi ${req.body.firstName},</p>
              <p>You have been invited as a <strong>Super Admin</strong> on the Projex platform.</p>
              <p><strong>Login Details:</strong></p>
              <ul>
                <li>URL: <a href="http://admin.projex.ng">admin.projex.ng</a></li>
                <li>Email: ${req.body.email}</li>
                <li>Temporary Password: <strong>${tempPass}</strong></li>
              </ul>
              <p>Please change your password after first login.</p>
              <p><strong>The Projex Team</strong></p>
            </div>
          </div>
        `,
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      data: { id: user.id, email: user.email, tempPassword: tempPass },
    });
  }),

  update: asyncHandler(async (req, res) => {
    const updated = await userRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),

  toggleActive: asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.params.id, req.user.companyId);
    if (!user) throw new NotFoundError("User");
    if (user.id === req.user.userId)
      throw new AppError("Cannot deactivate own account", 400);
    const updated = await userRepo.update(req.params.id, {
      is_active: !user.is_active,
    });
    res.json({ success: true, data: updated });
  }),
};
