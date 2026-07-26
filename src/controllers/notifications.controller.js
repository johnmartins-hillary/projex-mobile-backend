const { asyncHandler } = require("../middleware");
const { notificationRepo } = require("../repositories");

exports.notifications = {
  getAll: asyncHandler(async (req, res) => {
    const items = await notificationRepo.findByUser(req.user.userId);
    res.json({ success: true, data: items });
  }),

  readAll: asyncHandler(async (req, res) => {
    await notificationRepo.markAllRead(req.user.userId);
    res.json({ success: true });
  }),

  readOne: asyncHandler(async (req, res) => {
    await notificationRepo.markRead(req.params.id, req.user.userId);
    res.json({ success: true });
  }),
};
