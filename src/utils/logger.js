const winston = require("winston");
const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = printf(({ level, message, timestamp, requestId, stack, ...meta }) => {
  const rid = requestId ? ` [${requestId}]` : "";
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp}${rid} [${level}]: ${stack || message}${metaStr}`;
});

const isProd = process.env.NODE_ENV === "production";

exports.logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    isProd ? json() : combine(colorize(), devFormat)
  ),
  transports: [
    new winston.transports.Console(),
    ...(isProd ? [
      new winston.transports.File({ filename: "logs/error.log", level: "error" }),
      new winston.transports.File({ filename: "logs/combined.log" }),
    ] : []),
  ],
});

// Child logger with request context
exports.requestLogger = (requestId) => exports.logger.child({ requestId });
