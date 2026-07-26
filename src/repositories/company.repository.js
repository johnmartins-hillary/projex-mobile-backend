const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

class CompanyRepository extends BaseRepository {
  constructor() {
    super("companies");
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO companies (name, email, phone, plan, plan_expires_at, max_projects, max_users)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.name,
        data.email,
        data.phone || null,
        "STARTER",
        new Date(Date.now() + 14 * 86400000),
        2,
        5,
      ],
    );
    return rows[0];
  }

  async update(id, data) {
    const fieldMap = {
      plan: "plan",
      planExpiresAt: "plan_expires_at",
      plan_expires_at: "plan_expires_at",
      maxProjects: "max_projects",
      max_projects: "max_projects",
      maxUsers: "max_users",
      max_users: "max_users",
      name: "name",
      email: "email",
      phone: "phone",
      logoUrl: "logo_url",
    };

    const setClauses = [];
    const params = [];
    let i = 1;

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col && value !== undefined) {
        setClauses.push(`${col} = $${i++}`);
        params.push(value);
      }
    }

    if (!setClauses.length) return null;

    params.push(id);
    const { rows } = await query(
      `UPDATE companies SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      params,
    );
    return rows[0];
  }
}

module.exports = CompanyRepository;
