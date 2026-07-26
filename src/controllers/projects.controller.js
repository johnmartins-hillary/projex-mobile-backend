const { asyncHandler } = require("../middleware");
const { companyRepo, projectRepo } = require("../repositories");
const { NotFoundError, PlanLimitError } = require("../utils/errors");

exports.projects = {
  getAll: asyncHandler(async (req, res) => {
    const projects = await projectRepo.findByCompanyWithStats(
      req.user.companyId,
    );
    res.json({ success: true, data: projects });
  }),

  getOne: asyncHandler(async (req, res) => {
    const project = await projectRepo.findByIdWithMembers(
      req.params.id,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    res.json({ success: true, data: project });
  }),

  create: asyncHandler(async (req, res) => {
    const company = await companyRepo.findById(req.user.companyId);
    const active = await projectRepo.count({
      company_id: req.user.companyId,
      status: "ACTIVE",
    });
    if (active >= company.max_projects)
      throw new PlanLimitError(
        `${company.plan} plan allows max ${company.max_projects} active projects. Upgrade to add more.`,
      );
    const project = await projectRepo.create(
      { ...req.body, companyId: req.user.companyId },
      req.user.userId,
    );
    res
      .status(201)
      .json({ success: true, message: "Project created", data: project });
  }),

  update: asyncHandler(async (req, res) => {
    const existing = await projectRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Project");
    const updated = await projectRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),

  delete: asyncHandler(async (req, res) => {
    const existing = await projectRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Project");
    await projectRepo.deleteById(req.params.id);
    res.json({ success: true, message: "Project deleted" });
  }),
};
