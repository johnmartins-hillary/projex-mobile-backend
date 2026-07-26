const express = require("express");
const { chat } = require("../controllers/chat.controller");
const { protect } = require("../middleware");

const router = express.Router({ mergeParams: true });

router.get("/room", protect, chat.getRoom);
router.get("/messages", protect, chat.getMessages);
router.post("/messages", protect, chat.sendMessage);
router.patch("/messages/:messageId", protect, chat.editMessage);
router.delete("/messages/:messageId", protect, chat.deleteMessage);
router.get("/sign", protect, chat.sign);
router.post("/media", protect, chat.sendMedia);
router.post("/media/bulk", protect, chat.sendBulkMedia);
router.post("/react/:messageId", protect, chat.react);
router.post("/read", protect, chat.markRead);
router.get("/unread", protect, chat.getUnread);
router.get("/members", protect, chat.getMembers);

module.exports = router;
