require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { requestId, notFound, errorHandler } = require("./middleware");
const { logger } = require("./utils/logger");
const routes = require("./routes");
const { startCronJobs } = require("./services/cron.service");

startCronJobs();

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(requestId);
app.use(
  morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { success: false, message: "Too many requests" },
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: "Too many auth attempts" },
    skip: (req) => !req.path.includes("/auth/login"),
  }),
);

// Static files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Client portal HTML page — serves for any token
// Client portal HTML page
app.get("/portal/:token", (req, res) => {
  const fs = require("fs");
  const htmlPath = path.join(__dirname, "views/clientPortal.html");
  let html = fs.readFileSync(htmlPath, "utf8");

  // Inject the actual API base URL
  const apiBase = `${req.protocol}://${req.get("host")}/api/v1`;
  html = html.replace(
    'const apiBase = window.location.origin + "/api/v1";',
    `const apiBase = "${apiBase}";`,
  );

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

app.get("/health", (req, res) =>
  res.json({ status: "ok", service: "Projex API v2", timestamp: new Date() }),
);
app.use("/api/v1", routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
