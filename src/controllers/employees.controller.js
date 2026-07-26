const { asyncHandler } = require("../middleware");
const { employeeRepo } = require("../repositories");
const { NotFoundError } = require("../utils/errors");

exports.employees = {
  getAll: asyncHandler(async (req, res) => {
    const employees = await employeeRepo.findByCompany(
      req.user.companyId,
      req.query,
    );
    res.json({ success: true, data: employees });
  }),

  getOne: asyncHandler(async (req, res) => {
    const emp = await employeeRepo.findById(req.params.id, req.user.companyId);
    if (!emp) throw new NotFoundError("Employee");
    res.json({ success: true, data: emp });
  }),

  create: asyncHandler(async (req, res) => {
    const emp = await employeeRepo.create({
      ...req.body,
      companyId: req.user.companyId,
    });
    res.status(201).json({ success: true, data: emp });
  }),

  update: asyncHandler(async (req, res) => {
    const existing = await employeeRepo.findById(
      req.params.id,
      req.user.companyId,
    );
    if (!existing) throw new NotFoundError("Employee");
    const updated = await employeeRepo.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  }),

  setStatus: asyncHandler(async (req, res) => {
    const { status, terminationDate } = req.body;
    const updated = await employeeRepo.setStatus(
      req.params.id,
      status,
      terminationDate,
    );
    res.json({ success: true, data: updated });
  }),

  addDocument: asyncHandler(async (req, res) => {
    const doc = await employeeRepo.addDocument(req.params.id, req.body);
    res.status(201).json({ success: true, data: doc });
  }),

  getPayroll: asyncHandler(async (req, res) => {
    const {
      year = new Date().getFullYear(),
      month = new Date().getMonth() + 1,
    } = req.query;
    const rows = await employeeRepo.getPayrollSummary(
      req.user.companyId,
      parseInt(year),
      parseInt(month),
    );
    const total = rows.reduce((s, r) => s + parseFloat(r.total_pay || 0), 0);
    res.json({
      success: true,
      data: { employees: rows, total_payroll: total, year, month },
    });
  }),
};
