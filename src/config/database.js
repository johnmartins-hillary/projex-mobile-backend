const { Pool } = require("pg");
const { logger } = require("../utils/logger");

let pool;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      host:     process.env.DB_HOST || "localhost",
      port:     parseInt(process.env.DB_PORT || "5432"),
      user:     process.env.DB_USER || "projex",
      password: process.env.DB_PASSWORD || "projex_secret_2025",
      database: process.env.DB_NAME || "projex_db",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    });

    pool.on("connect", () => logger.debug("New DB client connected"));
    pool.on("error", (err) => logger.error("Unexpected DB client error:", err));

    pool.query("SELECT NOW()").then(() => {
      logger.info("✅ PostgreSQL connected");
    }).catch((err) => {
      logger.error("❌ PostgreSQL connection failed:", err.message);
      process.exit(1);
    });
  }
  return pool;
};

// Helper: execute query with automatic client return
const query = (text, params) => getPool().query(text, params);

// Helper: transaction wrapper
const withTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { getPool, query, withTransaction };
