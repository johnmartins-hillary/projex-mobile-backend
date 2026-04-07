require("dotenv").config();
const app = require("./app");
const { logger } = require("./utils/logger");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(
    `🚀 Projex API v2 running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
  );
  logger.info(`📊 Adminer DB GUI: http://localhost:8080`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Store io instance for use in routes
app.set("io", io);

io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Join company room
  socket.on("join:company", (companyId) => {
    socket.join(`company:${companyId}`);
    logger.info(`Socket ${socket.id} joined company:${companyId}`);
  });

  // Join supplier room
  socket.on("join:supplier", (supplierId) => {
    socket.join(`supplier:${supplierId}`);
    logger.info(`Socket ${socket.id} joined supplier:${supplierId}`);
  });

  // Join admin room
  socket.on("join:admin", () => {
    socket.join("admin");
    logger.info(`Socket ${socket.id} joined admin room`);
  });

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// Export io for use in other modules
module.exports = { server, io };

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
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection:", err);
});
