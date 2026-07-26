const { query } = require("../config/database");

class BaseRepository {
  constructor(table) {
    this.table = table;
  }

  async findById(id, companyId = null) {
    const conditions = [`id = $1`];
    const params = [id];
    if (companyId) {
      conditions.push(`company_id = $2`);
      params.push(companyId);
    }
    const { rows } = await query(
      `SELECT * FROM ${this.table} WHERE ${conditions.join(" AND ")} LIMIT 1`,
      params,
    );
    return rows[0] || null;
  }

  async findByCompany(companyId, opts = {}) {
    const { orderBy = "created_at DESC", limit = 100, offset = 0 } = opts;
    const { rows } = await query(
      `SELECT * FROM ${this.table} WHERE company_id = $1 ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    );
    return rows;
  }

  async count(where = {}) {
    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
    const values = Object.values(where);
    const { rows } = await query(
      `SELECT COUNT(*) as count FROM ${this.table}${conditions ? ` WHERE ${conditions}` : ""}`,
      values,
    );
    return parseInt(rows[0].count);
  }

  async deleteById(id) {
    const { rowCount } = await query(
      `DELETE FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }
}

module.exports = BaseRepository;
