/**
 * Chat socket handler
 * Call this in your main socket.js / server.js where you set up Socket.io:
 *
 *   const { registerChatHandlers } = require("./sockets/chat.socket");
 *   io.on("connection", (socket) => {
 *     registerChatHandlers(io, socket);
 *   });
 */

const jwt = require("jsonwebtoken");

const typingTimers = new Map(); // userId:roomId → timeout

const registerChatHandlers = (io, socket) => {
  // ── Join room ────────────────────────────────────────────
  socket.on("chat:join", ({ roomId }) => {
    if (!roomId) return;
    socket.join(`chat:${roomId}`);
    socket.data.currentChatRoom = roomId;
  });

  // ── Leave room ───────────────────────────────────────────
  socket.on("chat:leave", ({ roomId }) => {
    if (!roomId) return;
    socket.leave(`chat:${roomId}`);
    socket.data.currentChatRoom = null;
  });

  // ── Typing indicator ─────────────────────────────────────
  socket.on("chat:typing", ({ roomId }) => {
    if (!roomId || !socket.data.user) return;

    const { userId, firstName } = socket.data.user;

    // Broadcast to everyone else in the room
    socket
      .to(`chat:${roomId}`)
      .emit("chat:typing", { userId, firstName, roomId });

    // Auto-stop after 3 seconds of no activity
    const key = `${userId}:${roomId}`;
    if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));

    typingTimers.set(
      key,
      setTimeout(() => {
        socket
          .to(`chat:${roomId}`)
          .emit("chat:stop_typing", { userId, roomId });
        typingTimers.delete(key);
      }, 3000),
    );
  });

  // ── Stop typing ──────────────────────────────────────────
  socket.on("chat:stop_typing", ({ roomId }) => {
    if (!roomId || !socket.data.user) return;

    const { userId } = socket.data.user;
    const key = `${userId}:${roomId}`;

    if (typingTimers.has(key)) {
      clearTimeout(typingTimers.get(key));
      typingTimers.delete(key);
    }

    socket.to(`chat:${roomId}`).emit("chat:stop_typing", { userId, roomId });
  });

  // ── Disconnect cleanup ───────────────────────────────────
  socket.on("disconnect", () => {
    const roomId = socket.data.currentChatRoom;
    const user = socket.data.user;
    if (roomId && user) {
      const key = `${user.userId}:${roomId}`;
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key));
        typingTimers.delete(key);
      }
      socket.to(`chat:${roomId}`).emit("chat:stop_typing", {
        userId: user.userId,
        roomId,
      });
    }
  });
};

module.exports = { registerChatHandlers };
