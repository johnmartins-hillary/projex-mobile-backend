const { asyncHandler } = require("../middleware");
const { projectRepo } = require("../repositories");
const ChatRepository = require("../repositories/chat.repository");
const { generateSignature } = require("../services/cloudinary.service");
const { NotFoundError, AppError } = require("../utils/errors");

const chatRepo = new ChatRepository();

const validateProject = async (projectId, companyId) => {
  const project = await projectRepo.findById(projectId, companyId);
  if (!project) throw new NotFoundError("Project");
  return project;
};

const emitToRoom = (req, roomId, event, data) => {
  const io = req.app.get("io");
  if (io) io.to(`chat:${roomId}`).emit(event, data);
};

exports.chat = {
  // GET /projects/:projectId/chat/room
  getRoom: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const data = await chatRepo.getRoom(
      req.params.projectId,
      req.user.companyId,
      req.user.userId,
    );
    res.json({ success: true, data });
  }),

  // GET /projects/:projectId/chat/messages?before=<ISO>&limit=50
  getMessages: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );
    const messages = await chatRepo.getMessages(room.id, {
      limit: Number(req.query.limit) || 50,
      before: req.query.before || null,
    });
    res.json({ success: true, data: messages });
  }),

  // POST /projects/:projectId/chat/messages
  // Body: { content, replyToId?, mentions? }
  sendMessage: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const { content, replyToId, mentions = [] } = req.body;
    if (!content?.trim()) throw new AppError("Message content required", 400);

    const message = await chatRepo.createMessage(room.id, req.user.userId, {
      type: "TEXT",
      content: content.trim(),
      replyToId,
      mentions,
    });

    emitToRoom(req, room.id, "chat:message", message);

    // Push notification for mentions
    if (mentions.length) {
      const {
        notificationService,
      } = require("../services/notification.service");
      for (const m of mentions) {
        notificationService
          ?.sendToUser?.(m.userId, {
            title: "You were mentioned",
            body: `${req.user.firstName} mentioned you in Project Chat`,
            data: { type: "chat_mention", projectId: req.params.projectId },
          })
          .catch(() => {});
      }
    }

    res.status(201).json({ success: true, data: message });
  }),

  // PATCH /projects/:projectId/chat/messages/:messageId
  // Body: { content }
  editMessage: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const { content } = req.body;
    if (!content?.trim()) throw new AppError("Content required", 400);

    const message = await chatRepo.editMessage(
      req.params.messageId,
      req.user.userId,
      content.trim(),
    );
    if (!message) throw new NotFoundError("Message");

    emitToRoom(req, room.id, "chat:edited", message);
    res.json({ success: true, data: message });
  }),

  // DELETE /projects/:projectId/chat/messages/:messageId
  deleteMessage: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const result = await chatRepo.deleteMessage(
      req.params.messageId,
      req.user.userId,
    );
    if (!result) throw new NotFoundError("Message");

    emitToRoom(req, room.id, "chat:deleted", {
      messageId: req.params.messageId,
    });
    res.json({ success: true });
  }),

  // GET /projects/:projectId/chat/sign
  sign: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const signature = generateSignature("projex/chat");
    res.json({ success: true, data: signature });
  }),

  // POST /projects/:projectId/chat/media
  // Body: { fileUrl, fileName, fileSize, type, duration?, thumbUrl?,
  //         mediaWidth?, mediaHeight?, replyToId?, mentions?, content? }
  sendMedia: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const {
      fileUrl,
      fileName,
      fileSize,
      type,
      duration,
      replyToId,
      mentions = [],
      content,
      thumbUrl,
      mediaWidth,
      mediaHeight,
    } = req.body;

    if (!fileUrl) throw new AppError("File URL required", 400);
    if (!["VOICE", "FILE", "IMAGE", "VIDEO"].includes(type)) {
      throw new AppError("Invalid media type", 400);
    }

    const message = await chatRepo.createMessage(room.id, req.user.userId, {
      type,
      content: content || null,
      fileUrl,
      fileName,
      fileSize,
      duration,
      replyToId,
      mentions,
      thumbUrl,
      mediaWidth,
      mediaHeight,
    });

    emitToRoom(req, room.id, "chat:message", message);
    res.status(201).json({ success: true, data: message });
  }),

  // POST /projects/:projectId/chat/media/bulk
  // Body: { files: [{fileUrl,fileName,fileSize,type,thumbUrl,mediaWidth,mediaHeight}],
  //         replyToId?, mentions? }
  sendBulkMedia: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const { files, replyToId, mentions = [] } = req.body;
    if (!Array.isArray(files) || !files.length) {
      throw new AppError("files array required", 400);
    }
    if (files.length > 10) throw new AppError("Max 10 files at once", 400);

    for (const f of files) {
      if (!["IMAGE", "VIDEO"].includes(f.type)) {
        throw new AppError("Bulk upload only supports IMAGE and VIDEO", 400);
      }
    }

    const messages = await chatRepo.createBulkMessages(
      room.id,
      req.user.userId,
      files,
      replyToId,
      mentions,
    );

    // Emit each message individually so clients get them in order
    messages.forEach((msg) => emitToRoom(req, room.id, "chat:message", msg));

    res.status(201).json({ success: true, data: messages });
  }),

  // POST /projects/:projectId/chat/react/:messageId
  react: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );

    const { emoji } = req.body;
    if (!emoji) throw new AppError("Emoji required", 400);

    const reactions = await chatRepo.toggleReaction(
      req.params.messageId,
      req.user.userId,
      emoji,
    );
    emitToRoom(req, room.id, "chat:reaction", {
      messageId: req.params.messageId,
      reactions,
    });
    res.json({ success: true, data: reactions });
  }),

  // POST /projects/:projectId/chat/read
  markRead: asyncHandler(async (req, res) => {
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );
    await chatRepo.markRead(room.id, req.user.userId);
    emitToRoom(req, room.id, "chat:read", {
      userId: req.user.userId,
      roomId: room.id,
      lastReadAt: new Date().toISOString(),
    });
    res.json({ success: true });
  }),

  // GET /projects/:projectId/chat/unread
  getUnread: asyncHandler(async (req, res) => {
    const room = await chatRepo.getOrCreateRoom(
      req.params.projectId,
      req.user.companyId,
    );
    const count = await chatRepo.getUnreadCount(room.id, req.user.userId);
    res.json({ success: true, data: { unread_count: count } });
  }),

  // GET /projects/:projectId/chat/members
  getMembers: asyncHandler(async (req, res) => {
    await validateProject(req.params.projectId, req.user.companyId);
    const members = await chatRepo.getProjectMembers(
      req.params.projectId,
      req.user.companyId,
    );
    res.json({ success: true, data: members });
  }),
};
