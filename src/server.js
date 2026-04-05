require("dotenv").config();
const app = require("./app");
const { logger } = require("./utils/logger");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Projex API v2 running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  logger.info(`📊 Adminer DB GUI: http://localhost:8080`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
});

const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down`);
  server.close(() => { logger.info("Server closed"); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => { logger.error("Unhandled rejection:", err); });
