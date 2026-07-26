const { asyncHandler } = require("../middleware");
const { projectRepo } = require("../repositories");
const ScheduleRepository = require("../repositories/schedule.repository");
const { NotFoundError, AppError } = require("../utils/errors");
const XLSX = require("xlsx");
const { detectAndParse } = require("../utils/schedule.parser");

const scheduleRepo = new ScheduleRepository();

const validateProject = async (projectId, companyId) => {
  const project = await projectRepo.findById(projectId, companyId);
  if (!project) throw new NotFoundError("Project");
  return project;
};

exports.schedule = {
  // GET /projects/:projectId/schedule
  getSchedule: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const schedule = await scheduleRepo.getSchedule(req.params.projectId);
    res.json({ success: true, data: schedule });
  }),

  // POST /projects/:projectId/schedule/setup
  setup: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);

    const { scheduleType } = req.body;
    if (!["SCHEDULE", "MILESTONE", "UPLOAD"].includes(scheduleType)) {
      throw new AppError("Invalid schedule type", 400);
    }

    // UPLOAD isn't a distinct tracking mode of its own — it produces the
    // exact same phase/task/resource shape as SCHEDULE, just populated
    // from a file instead of typed by hand. Nothing downstream ever
    // branched on schedule_type === 'UPLOAD' vs 'SCHEDULE'; storing them
    // separately only served to force "delete everything to switch"
    // between two things that were never actually different. MILESTONE
    // remains genuinely distinct (no tasks, binary completion).
    const storedType = scheduleType === "UPLOAD" ? "SCHEDULE" : scheduleType;

    const current = await scheduleRepo.getScheduleType(req.params.projectId);
    if (current) {
      const hasPhases = await scheduleRepo.hasPhases(req.params.projectId);
      // Only block when actually switching modes (e.g. MILESTONE <->
      // SCHEDULE). Re-running setup with an equivalent type — including
      // choosing "Upload" on a project already in SCHEDULE mode, which is
      // exactly what happens when importing into an existing manually-
      // built schedule — is a no-op, not a conflict.
      if (hasPhases && current !== storedType) {
        throw new AppError(
          `Project already has a ${current} schedule with phases. Delete it first to switch tracking modes.`,
          409,
        );
      }
      // Same underlying mode, or orphaned state — safe to proceed.
    }

    const updated = await scheduleRepo.setScheduleType(
      req.params.projectId,
      storedType,
    );
    res.json({ success: true, data: updated });
  }),

  // DELETE /projects/:projectId/schedule
  deleteSchedule: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    await scheduleRepo.deleteSchedule(req.params.projectId);
    res.json({ success: true, message: "Schedule deleted" });
  }),

  // PATCH /projects/:projectId/schedule/budget
  setBudgetOverride: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const { amount } = req.body;
    if (!amount || isNaN(Number(amount)))
      throw new AppError("Valid amount required", 400);
    const updated = await scheduleRepo.setBudgetOverride(
      req.params.projectId,
      Number(amount),
    );
    if (!updated) throw new NotFoundError("Project");
    res.json({ success: true, data: updated });
  }),

  // GET /projects/:projectId/schedule/template
  downloadTemplate: asyncHandler(async (req, res) => {
    const { generateTemplate } = require("../utils/schedule.parser");
    const buf = generateTemplate();
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=projex_schedule_template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return res.send(buf);
    // ── old template code below (unreachable, kept for reference) ──
    const wb = XLSX.utils.book_new();
    const data = [
      [
        "Phase Name",
        "Phase Weight %",
        "Task Name",
        "Start Date",
        "End Date",
        "Resource Type",
        "Resource Description",
        "Unit",
        "Quantity",
        "Unit Cost",
      ],
      [
        "Substructure",
        35,
        "Excavation",
        "2024-01-01",
        "2024-01-07",
        "LABOUR",
        "Excavator Operator",
        "days",
        2,
        15000,
      ],
      [
        "Substructure",
        35,
        "Excavation",
        "2024-01-01",
        "2024-01-07",
        "EQUIPMENT",
        "Excavator",
        "days",
        2,
        45000,
      ],
      [
        "Substructure",
        35,
        "Excavation",
        "2024-01-01",
        "2024-01-07",
        "MATERIAL",
        "Fuel (litres)",
        "litres",
        100,
        650,
      ],
      [
        "Substructure",
        35,
        "Blinding",
        "2024-01-08",
        "2024-01-10",
        "LABOUR",
        "Mason",
        "days",
        4,
        8000,
      ],
      [
        "Substructure",
        35,
        "Blinding",
        "2024-01-08",
        "2024-01-10",
        "MATERIAL",
        "Cement (50kg bag)",
        "bags",
        20,
        6500,
      ],
      [
        "Substructure",
        35,
        "Blinding",
        "2024-01-08",
        "2024-01-10",
        "MATERIAL",
        "Sharp Sand (tonnes)",
        "tonnes",
        3,
        18000,
      ],
      [
        "Superstructure",
        40,
        "Columns GF",
        "2024-04-01",
        "2024-04-30",
        "LABOUR",
        "Carpenter",
        "days",
        10,
        9000,
      ],
      [
        "Superstructure",
        40,
        "Columns GF",
        "2024-04-01",
        "2024-04-30",
        "LABOUR",
        "Steel Fixer",
        "days",
        10,
        10000,
      ],
      [
        "Superstructure",
        40,
        "Columns GF",
        "2024-04-01",
        "2024-04-30",
        "MATERIAL",
        "Reinforcement (kg)",
        "kg",
        500,
        750,
      ],
      [
        "Superstructure",
        40,
        "Columns GF",
        "2024-04-01",
        "2024-04-30",
        "MATERIAL",
        "Cement (50kg bag)",
        "bags",
        30,
        6500,
      ],
      [
        "Finishes",
        25,
        "Plastering",
        "2024-09-01",
        "2024-09-30",
        "LABOUR",
        "Plasterer",
        "days",
        20,
        8500,
      ],
      [
        "Finishes",
        25,
        "Plastering",
        "2024-09-01",
        "2024-09-30",
        "MATERIAL",
        "Cement (50kg bag)",
        "bags",
        40,
        6500,
      ],
      [
        "Finishes",
        25,
        "Plastering",
        "2024-09-01",
        "2024-09-30",
        "SUBCONTRACT",
        "Electrical First Fix",
        "lump sum",
        1,
        350000,
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 20 },
      { wch: 14 },
      { wch: 25 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 28 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
    ];
    // Bold header row
    const headerStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: "0A2342" } },
    };
    ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1"].forEach(
      (cell) => {
        if (ws[cell]) ws[cell].s = headerStyle;
      },
    );
    XLSX.utils.book_append_sheet(wb, ws, "Schedule");
    const buf2 = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=projex_schedule_template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buf2);
  }),

  // POST /projects/:projectId/schedule/upload
  // Accepts: .xlsx (Projex template), .xml (P6 or MS Project)
  upload: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    if (!req.file) throw new AppError("No file uploaded", 400);

    const currentType = await scheduleRepo.getScheduleType(
      req.params.projectId,
    );
    // Import is allowed into an empty project OR an existing SCHEDULE-mode
    // one (whether it was built manually or previously imported — both
    // produce the same phase/task/resource shape, see setup() above).
    // MILESTONE is genuinely incompatible (no tasks at all), so importing
    // into one still requires deleting it first.
    if (currentType === "MILESTONE") {
      throw new AppError(
        "This project is set up for milestone tracking. Delete the existing milestones before importing a full schedule.",
        409,
      );
    }

    // Parse the file — auto-detects format
    let result;
    try {
      result = detectAndParse(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
    } catch (e) {
      throw new AppError(e.message, 400);
    }

    const { format, phases } = result;
    if (!phases.length) throw new AppError("No phases found in file", 400);

    // Validate weights if provided
    const totalWeight = phases.reduce((s, p) => s + Number(p.weight || 0), 0);
    if (totalWeight > 0 && Math.abs(totalWeight - 100) > 2) {
      throw new AppError(
        `Phase weights total ${totalWeight}%. They must add up to 100%.`,
        400,
      );
    }

    // Clear any existing data first.
    // NOTE: this is still an unconditional full wipe — importing into an
    // existing hand-built SCHEDULE now passes the gate above, but will
    // delete all of it (tasks, statuses, progress, procurement flags,
    // wastage) before re-importing. That's a separate, riskier change
    // (needs real "replace" vs "merge" semantics) intentionally deferred —
    // this fix only addresses the 409 gating, not the wipe itself.
    if (currentType) await scheduleRepo.deleteSchedule(req.params.projectId);

    await scheduleRepo.importSchedule(
      req.params.projectId,
      req.user.companyId,
      phases,
    );
    const schedule = await scheduleRepo.getSchedule(req.params.projectId);

    res.status(201).json({
      success: true,
      data: schedule,
      meta: {
        format,
        phasesImported: phases.length,
        tasksImported: phases.reduce((s, p) => s + p.tasks.length, 0),
        resourcesImported: phases.reduce(
          (s, p) =>
            s + p.tasks.reduce((ts, t) => ts + (t.resources?.length || 0), 0),
          0,
        ),
      },
    });
  }),

  // ── Phases ─────────────────────────────────────────────────

  createPhase: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const phase = await scheduleRepo.createPhase(
      req.params.projectId,
      req.user.companyId,
      req.body,
    );
    res.status(201).json({ success: true, data: phase });
  }),

  updatePhase: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const phase = await scheduleRepo.updatePhase(
      req.params.phaseId,
      req.params.projectId,
      req.body,
    );
    if (!phase) throw new NotFoundError("Phase");
    res.json({ success: true, data: phase });
  }),

  deletePhase: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const result = await scheduleRepo.deletePhase(
      req.params.phaseId,
      req.params.projectId,
    );
    if (!result) throw new NotFoundError("Phase");
    res.json({ success: true, message: "Phase deleted" });
  }),

  updateMilestoneStatus: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const { status } = req.body;
    if (!["PENDING", "COMPLETED"].includes(status))
      throw new AppError("Invalid status", 400);
    const updated = await scheduleRepo.updateMilestoneStatus(
      req.params.phaseId,
      req.params.projectId,
      status,
    );
    if (!updated) throw new NotFoundError("Milestone");
    res.json({ success: true, data: updated });
  }),

  // ── Tasks ───────────────────────────────────────────────────

  createTask: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const task = await scheduleRepo.createTask(
      req.params.phaseId,
      req.params.projectId,
      req.body,
    );
    if (!task) throw new NotFoundError("Phase");
    res.status(201).json({ success: true, data: task });
  }),

  updateTask: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const task = await scheduleRepo.updateTask(
      req.params.taskId,
      req.params.phaseId,
      req.body,
    );
    if (!task) throw new NotFoundError("Task");
    res.json({ success: true, data: task });
  }),

  updateTaskProgress: asyncHandler(async (req, res) => {
    const { phaseId, taskId } = req.params;
    const { progressPct } = req.body;
    if (progressPct === undefined || progressPct === null) {
      return res
        .status(400)
        .json({ success: false, message: "progressPct is required" });
    }
    const task = await scheduleRepo.updateTaskProgress(
      taskId,
      phaseId,
      Number(progressPct),
    );
    if (!task) throw new NotFoundError("Task");
    res.json({ success: true, data: task });
  }),

  updateTaskStatus: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const { status } = req.body;
    if (!["PENDING", "IN_PROGRESS", "COMPLETED"].includes(status)) {
      throw new AppError("Invalid status", 400);
    }
    const task = await scheduleRepo.updateTaskStatus(
      req.params.taskId,
      req.params.phaseId,
      req.params.projectId,
      status,
    );
    if (!task) throw new NotFoundError("Task");
    const schedule = await scheduleRepo.getSchedule(req.params.projectId);
    res.json({ success: true, data: { task, schedule } });
  }),

  deleteTask: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const result = await scheduleRepo.deleteTask(
      req.params.taskId,
      req.params.phaseId,
    );
    if (!result) throw new NotFoundError("Task");
    res.json({ success: true, message: "Task deleted" });
  }),

  // ── Resources ───────────────────────────────────────────────

  getResources: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const resources = await scheduleRepo.getTaskResources(req.params.taskId);
    res.json({ success: true, data: resources });
  }),

  // REWORKED: MATERIAL resources now resolve/create a store item.
  //
  // Body shape:
  //   type: "LABOUR" | "MATERIAL" | "EQUIPMENT" | "SUBCONTRACT"
  //   quantity, unitCost: always required
  //   notes: optional
  //
  //   For LABOUR / EQUIPMENT / SUBCONTRACT:
  //     description, unit: required, used as-is.
  //
  //   For MATERIAL — pick ONE:
  //     storeItemId: id of an existing project_store item to attach to
  //       (description/unit will be taken from that item, ignoring
  //       whatever was typed in the form).
  //     description (+ optional unit): no storeItemId given means "this is
  //       a new material" — a project_store item is created from these
  //       fields and the resource links to it.
  // Body shape:
  //   type: "LABOUR" | "MATERIAL" | "EQUIPMENT" | "SUBCONTRACT"
  //   quantity, unitCost: always required
  //   notes: optional
  //
  //   For MATERIAL — pick ONE:
  //     storeItemId: id of an existing project_store item to attach to.
  //     description (+ optional unit): creates a new material — resolved
  //       or created in resource_catalog, then in this project's store.
  //
  //   For LABOUR / EQUIPMENT / SUBCONTRACT — pick ONE:
  //     catalogId: id of an existing resource_catalog entry (that type).
  //     description (+ optional unit): creates a new catalog entry of
  //       that type.
  createResource: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const {
      type,
      description,
      unit,
      quantity,
      unitCost,
      notes,
      storeItemId,
      catalogId,
      durationDays,
      sourceUnit,
    } = req.body;

    if (!["LABOUR", "MATERIAL", "EQUIPMENT", "SUBCONTRACT"].includes(type)) {
      throw new AppError(
        "type must be LABOUR, MATERIAL, EQUIPMENT, or SUBCONTRACT",
        400,
      );
    }
    if (quantity == null || unitCost == null) {
      throw new AppError("quantity and unitCost are required", 400);
    }

    if (type === "MATERIAL") {
      if (!storeItemId && !description) {
        throw new AppError(
          "Provide storeItemId to use an existing store item, or description to create a new one",
          400,
        );
      }
      if (!storeItemId && !unit) {
        throw new AppError(
          "unit is required when creating a new material",
          400,
        );
      }
    } else {
      if (!catalogId && !description) {
        throw new AppError(
          "Provide catalogId to use an existing catalog entry, or description to create a new one",
          400,
        );
      }
      if (!catalogId && !unit) {
        throw new AppError(
          `unit is required when creating a new ${type.toLowerCase()}`,
          400,
        );
      }
    }

    const resource = await scheduleRepo.createResource(
      req.params.taskId,
      req.params.phaseId,
      req.params.projectId,
      req.user.companyId,
      {
        type,
        description,
        unit,
        quantity,
        unitCost,
        notes,
        storeItemId,
        catalogId,
        durationDays,
        sourceUnit,
      },
    );
    res.status(201).json({ success: true, data: resource });
  }),

  updateResource: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const resource = await scheduleRepo.updateResource(
      req.params.resourceId,
      req.params.taskId,
      req.body,
    );
    if (!resource) throw new NotFoundError("Resource");
    res.json({ success: true, data: resource });
  }),

  deleteResource: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const result = await scheduleRepo.deleteResource(
      req.params.resourceId,
      req.params.taskId,
    );
    if (!result) throw new NotFoundError("Resource");
    res.json({ success: true, message: "Resource deleted" });
  }),

  markProcured: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const { isProcured } = req.body;
    const resource = await scheduleRepo.markResourceProcured(
      req.params.resourceId,
      req.params.taskId,
      isProcured,
    );
    if (!resource) throw new NotFoundError("Resource");
    res.json({ success: true, data: resource });
  }),

  // REMOVED: linkMaterial and requestFromStore. Both called repository
  // methods (linkResourceToMaterial, requestFromStore) that queried the
  // `materials` table, which is no longer the live material ledger —
  // project_store is. Linking now happens through createResource's
  // storeItemId at creation time, or store.repository.js's
  // linkStoreItemToResource after the fact. If routes still point at
  // "link-material" / "request-store", remove those two lines from
  // schedule.routes.js as well.

  // ── Reports ─────────────────────────────────────────────────

  getProcurement: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const { type, isProcured, phaseId } = req.query;
    const data = await scheduleRepo.getProcurementSchedule(
      req.params.projectId,
      {
        type: type || null,
        isProcured:
          isProcured !== undefined ? isProcured === "true" : undefined,
        phaseId: phaseId || null,
      },
    );
    res.json({ success: true, data });
  }),

  getCostVariance: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const data = await scheduleRepo.getCostVariance(req.params.projectId);
    res.json({ success: true, data });
  }),
};
