require("dotenv").config();
const app = require("./app");
const { logger } = require("./utils/logger");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { registerChatHandlers } = require("./services/chat.socket");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(
    `🚀 Projex API v2 running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
  );
  logger.info(`📊 Adminer DB GUI: http://localhost:8080`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
});

// ── Socket.io setup ───────────────────────────────────────────

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.set("io", io);

// ── Auth middleware — attach user to every socket ─────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      socket.data.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Invalid token — allow connection, chat handlers will just lack user context
    }
  }
  next();
});

// ── Connection handler ────────────────────────────────────────

io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Existing rooms
  socket.on("join:company", (companyId) => {
    socket.join(`company:${companyId}`);
    logger.info(`Socket ${socket.id} joined company:${companyId}`);
  });
  socket.on("join:supplier", (supplierId) => {
    socket.join(`supplier:${supplierId}`);
    logger.info(`Socket ${socket.id} joined supplier:${supplierId}`);
  });
  socket.on("join:admin", () => {
    socket.join("admin");
    logger.info(`Socket ${socket.id} joined admin room`);
  });

  // Chat handlers
  registerChatHandlers(io, socket);

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

module.exports = { server, io };

// ── Graceful shutdown ─────────────────────────────────────────

const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) =>
  logger.error("Unhandled rejection:", err),
);
