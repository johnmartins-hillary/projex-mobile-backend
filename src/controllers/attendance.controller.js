const { asyncHandler } = require("../middleware");
const { projectRepo, attendanceRepo } = require("../repositories");
const { NotFoundError, AppError } = require("../utils/errors");

exports.attendance = {
  checkIn: asyncHandler(async (req, res) => {
    const existing = await attendanceRepo.findTodayByUser(
      req.user.userId,
      req.body.projectId,
    );
    if (existing)
      throw new AppError("Already checked in. Check out first.", 400);
    const record = await attendanceRepo.checkIn({
      ...req.body,
      userId: req.user.userId,
    });
    res.status(201).json({ success: true, data: record });
  }),

  checkOut: asyncHandler(async (req, res) => {
    const record = await attendanceRepo.checkOut(req.params.id);
    if (!record) throw new NotFoundError("Attendance record");
    res.json({ success: true, data: record });
  }),

  getAll: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.query.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const records = await attendanceRepo.findByProject(
      req.query.projectId,
      req.query.date,
    );
    res.json({ success: true, data: records });
  }),
};
