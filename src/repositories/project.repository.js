// backend/src/repositories/project.repository.js
const { query, withTransaction } = require("../config/database");
const BaseRepository = require("./base.repository");

class ProjectRepository extends BaseRepository {
  constructor() {
    super("projects");
  }

  async findByCompanyWithStats(companyId) {
    const { rows } = await query(
      `SELECT p.*,
        COALESCE(p.schedule_estimated_budget, 0)::numeric AS schedule_estimated_budget,
        COALESCE(SUM(b.allocated), 0)::numeric AS total_allocated,

        -- Actual spend = approved expenses + stock-in transactions
        (
          COALESCE((
            SELECT SUM(e.amount)
            FROM expenses e
            WHERE e.project_id = p.id AND e.status = 'APPROVED'
          ), 0)
          +
          COALESCE((
            SELECT SUM(st.total_cost)
            FROM stock_transactions st
            WHERE st.project_id = p.id AND st.type = 'STOCK_IN'
          ), 0)
        )::numeric AS total_spent

       FROM projects p
       LEFT JOIN budgets b          ON b.project_id  = p.id
       LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE p.company_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [companyId],
    );
    return rows;
  }

  async findByIdWithMembers(id, companyId) {
    const { rows: projects } = await query(
      `SELECT p.*,
        COALESCE(p.schedule_estimated_budget, 0)::numeric AS schedule_estimated_budget,
        COALESCE(SUM(b.allocated), 0)::numeric AS total_allocated,
        (
          COALESCE((
            SELECT SUM(e.amount)
            FROM expenses e
            WHERE e.project_id = p.id AND e.status = 'APPROVED'
          ), 0)
          +
          COALESCE((
            SELECT SUM(st.total_cost)
            FROM stock_transactions st
            WHERE st.project_id = p.id AND st.type = 'STOCK_IN'
          ), 0)
        )::numeric AS total_spent
       FROM projects p
       LEFT JOIN budgets b ON b.project_id = p.id
       WHERE p.id = $1 AND p.company_id = $2
       GROUP BY p.id`,
      [id, companyId],
    );
    if (!projects[0]) return null;
    const { rows: members } = await query(
      `SELECT pm.role, u.id, u.first_name, u.last_name, u.email, u.avatar_url
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [id],
    );
    return { ...projects[0], members };
  }

  async create(data, userId) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO projects
           (company_id, name, description, type, status, location,
            latitude, longitude, start_date, end_date, total_budget,
            client_name, client_email, client_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          data.companyId,
          data.name,
          data.description || null,
          data.type,
          data.status || "ACTIVE",
          data.location || null,
          data.latitude || null,
          data.longitude || null,
          data.startDate || null,
          data.endDate || null,
          data.totalBudget || 0,
          data.clientName || null,
          data.clientEmail || null,
          data.clientPhone || null,
        ],
      );
      const project = rows[0];
      await client.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)",
        [project.id, userId, "PROJECT_OWNER"],
      );
      return project;
    });
  }

  async update(id, data) {
    const allowed = [
      "name",
      "description",
      "type",
      "status",
      "location",
      "latitude",
      "longitude",
      "start_date",
      "end_date",
      "total_budget",
      "client_name",
      "client_email",
      "client_phone",
      "image_url",
      "site_latitude",
      "site_longitude",
      "site_radius",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE projects SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }
}

module.exports = ProjectRepository;
