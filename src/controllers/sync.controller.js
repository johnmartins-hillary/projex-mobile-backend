const { asyncHandler } = require("../middleware");
const {
  materialRepo,
  visitorRepo,
  attendanceRepo,
  expenseRepo,
  syncRepo,
} = require("../repositories");

exports.sync = {
  pull: asyncHandler(async (req, res) => {
    const { deviceId } = req.query;
    const lastPulled = await syncRepo.getCursor(
      req.user.userId,
      deviceId || "default",
    );
    const changes = await syncRepo.getChangesSince(
      req.user.companyId,
      lastPulled,
    );
    await syncRepo.updateCursor(req.user.userId, deviceId || "default");
    res.json({
      success: true,
      data: {
        changes,
        pulledAt: new Date().toISOString(),
        lastPulled: lastPulled.toISOString(),
      },
    });
  }),

  push: asyncHandler(async (req, res) => {
    const { operations } = req.body;
    const results = [];
    for (const op of operations) {
      try {
        let result;
        switch (`${op.entity}:${op.action}`) {
          case "materials:stockIn":
            result = await materialRepo.stockIn(op.id, {
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "materials:stockOut":
            result = await materialRepo.stockOut(op.id, {
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "visitors:create":
            result = await visitorRepo.create({
              ...op.payload,
              loggedById: req.user.userId,
            });
            break;
          case "visitors:checkout":
            result = await visitorRepo.checkout(op.id);
            break;
          case "attendance:checkIn":
            result = await attendanceRepo.checkIn({
              ...op.payload,
              userId: req.user.userId,
            });
            break;
          case "attendance:checkOut":
            result = await attendanceRepo.checkOut(op.id);
            break;
          case "expenses:create":
            result = await expenseRepo.create({
              ...op.payload,
              submittedById: req.user.userId,
            });
            break;
          default:
            result = {
              skipped: true,
              reason: `Unknown operation: ${op.entity}:${op.action}`,
            };
        }
        results.push({ localId: op.localId, success: true, data: result });
      } catch (err) {
        results.push({
          localId: op.localId,
          success: false,
          error: err.message,
        });
      }
    }
    res.json({
      success: true,
      data: { results, processedAt: new Date().toISOString() },
    });
  }),
};
