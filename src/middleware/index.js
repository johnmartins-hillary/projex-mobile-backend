// ── middleware/requestId.js ───────────────────────────────────
const { v4: uuidv4 } = require("uuid");

const requestId = (req, res, next) => {
  req.requestId = req.headers["x-request-id"] || uuidv4();
  res.setHeader("x-request-id", req.requestId);
  next();
};

// ── middleware/auth.js ────────────────────────────────────────
const jwt = require("jsonwebtoken");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

const protect = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return next(new UnauthorizedError("No token provided"));
  const token = auth.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return next(new UnauthorizedError("Token expired"));
    return next(new UnauthorizedError("Invalid token"));
  }
};

const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({
          success: false,
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: `Access denied. Required role: ${roles.join(" or ")}. Your role: ${req.user.role}`,
      });
    }
    next();
  };

// ── middleware/validate.js ────────────────────────────────────
const { validationResult } = require("express-validator");
const { ValidationError } = require("../utils/errors");

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map(e => ({ field: e.path, message: e.msg }));
    return next(new ValidationError("Validation failed", errors));
  }
  next();
};

// ── middleware/errorHandler.js ────────────────────────────────
const { logger } = require("../utils/logger");
const { AppError } = require("../utils/errors");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (req, res, next) =>
  next(new AppError(`Route not found: ${req.originalUrl}`, 404, "NOT_FOUND"));

const errorHandler = (err, req, res, next) => {
  const log = logger.child({ requestId: req.requestId });

  // Map known DB errors
  if (err.code === "23505") err = new AppError("A record with that value already exists", 409, "CONFLICT");
  if (err.code === "23503") err = new AppError("Related record not found", 400, "FK_VIOLATION");
  if (err.code === "23502") err = new AppError("Required field missing", 400, "NULL_VIOLATION");

  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  if (!isOperational) {
    log.error("Unhandled error:", { message: err.message, stack: err.stack });
  } else {
    log.warn("Operational error:", { code: err.code, message: err.message, statusCode });
  }

  res.status(statusCode).json({
    success: false,
    code: err.code || "INTERNAL_ERROR",
    message: err.message || "Internal server error",
    ...(err.errors && { errors: err.errors }),
    ...(process.env.NODE_ENV === "development" && !isOperational && { stack: err.stack }),
    requestId: req.requestId,
  });
};


module.exports = { requestId, protect, authorize, validate, asyncHandler, notFound, errorHandler };
