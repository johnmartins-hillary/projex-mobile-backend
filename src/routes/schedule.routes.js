const express = require("express");
const multer = require("multer");
const { schedule } = require("../controllers/schedule.controller");
const { protect, authorize } = require("../middleware");

const router = express.Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || "").split(".").pop()?.toLowerCase();
    if (["xlsx", "xls", "xml"].includes(ext || "")) cb(null, true);
    else
      cb(
        new Error(
          "Upload a .xlsx (MS Project Excel export) or .xml (Primavera P6 XML) file.",
        ),
      );
  },
});

const owner = authorize("SUPER_ADMIN", "PROJECT_OWNER", "ADMIN");

// ── Schedule meta ──────────────────────────────────────────────
router.get("/", protect, schedule.getSchedule);
router.post("/setup", protect, owner, schedule.setup);
router.delete("/", protect, owner, schedule.deleteSchedule);
router.patch("/budget", protect, owner, schedule.setBudgetOverride);
router.post("/upload", protect, owner, upload.single("file"), schedule.upload);
router.get("/procurement", protect, schedule.getProcurement);
router.get("/variance", protect, schedule.getCostVariance);

// ── Phases ─────────────────────────────────────────────────────
router.post("/phases", protect, owner, schedule.createPhase);
router.put("/phases/:phaseId", protect, owner, schedule.updatePhase);
router.delete("/phases/:phaseId", protect, owner, schedule.deletePhase);
router.patch(
  "/phases/:phaseId/milestone-status",
  protect,
  owner,
  schedule.updateMilestoneStatus,
);

// ── Tasks ──────────────────────────────────────────────────────
router.post("/phases/:phaseId/tasks", protect, owner, schedule.createTask);
router.put(
  "/phases/:phaseId/tasks/:taskId",
  protect,
  owner,
  schedule.updateTask,
);
router.delete(
  "/phases/:phaseId/tasks/:taskId",
  protect,
  owner,
  schedule.deleteTask,
);
router.patch(
  "/phases/:phaseId/tasks/:taskId/status",
  protect,
  schedule.updateTaskStatus,
);
router.patch(
  "/phases/:phaseId/tasks/:taskId/progress",
  protect,
  schedule.updateTaskProgress,
);

// ── Resources ──────────────────────────────────────────────────
router.get(
  "/phases/:phaseId/tasks/:taskId/resources",
  protect,
  schedule.getResources,
);
router.post(
  "/phases/:phaseId/tasks/:taskId/resources",
  protect,
  owner,
  schedule.createResource,
);
router.put(
  "/phases/:phaseId/tasks/:taskId/resources/:resourceId",
  protect,
  owner,
  schedule.updateResource,
);
router.delete(
  "/phases/:phaseId/tasks/:taskId/resources/:resourceId",
  protect,
  owner,
  schedule.deleteResource,
);
router.patch(
  "/phases/:phaseId/tasks/:taskId/resources/:resourceId/procure",
  protect,
  owner,
  schedule.markProcured,
);

module.exports = router;
