const { query, withTransaction } = require("../config/database");

// ── Base Repository ───────────────────────────────────────────
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

// ── User Repository ───────────────────────────────────────────
class UserRepository extends BaseRepository {
  constructor() {
    super("users");
  }

  async findByEmail(email) {
    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    return rows[0] || null;
  }

  async findByCompanyWithCount(companyId) {
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
              u.role, u.is_active, u.avatar_url, u.language,
              u.last_login_at, u.push_token, u.created_at
       FROM users u WHERE u.company_id = $1 ORDER BY u.first_name`,
      [companyId],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO users (company_id, first_name, last_name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.companyId,
        data.firstName,
        data.lastName,
        data.email,
        data.phone || null,
        data.passwordHash,
        data.role || "SITE_MANAGER",
      ],
    );
    return rows[0];
  }

  async updateRefreshToken(id, token) {
    await query(
      "UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2",
      [token, id],
    );
  }

  async updateResetToken(id, token, exp) {
    await query(
      "UPDATE users SET reset_token = $1, reset_token_exp = $2 WHERE id = $3",
      [token, exp, id],
    );
  }

  async findByResetToken(token) {
    const { rows } = await query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_exp > NOW() LIMIT 1",
      [token],
    );
    return rows[0] || null;
  }

  async updatePassword(id, passwordHash) {
    await query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_exp = NULL, refresh_token = NULL WHERE id = $2",
      [passwordHash, id],
    );
  }

  async updatePushToken(id, pushToken) {
    await query("UPDATE users SET push_token = $1 WHERE id = $2", [
      pushToken,
      id,
    ]);
  }

  async update(id, data) {
    const allowed = [
      "first_name",
      "last_name",
      "phone",
      "language",
      "avatar_url",
      "is_active",
      "role",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }
}

// ── Company Repository ────────────────────────────────────────
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

// ── Project Repository ────────────────────────────────────────
class ProjectRepository extends BaseRepository {
  constructor() {
    super("projects");
  }

  async findByCompanyWithStats(companyId) {
    const { rows } = await query(
      `SELECT p.*,
        COALESCE(SUM(b.allocated),0)::numeric AS total_allocated,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'APPROVED'),0)::numeric AS total_spent,
        COUNT(DISTINCT pm.user_id) AS member_count
       FROM projects p
       LEFT JOIN budgets b ON b.project_id = p.id
       LEFT JOIN expenses e ON e.project_id = p.id
       LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE p.company_id = $1
       GROUP BY p.id ORDER BY p.created_at DESC`,
      [companyId],
    );
    return rows;
  }

  async findByIdWithMembers(id, companyId) {
    const { rows: projects } = await query(
      `SELECT p.*, COALESCE(SUM(b.allocated),0)::numeric AS total_allocated
       FROM projects p LEFT JOIN budgets b ON b.project_id = p.id
       WHERE p.id = $1 AND p.company_id = $2 GROUP BY p.id`,
      [id, companyId],
    );
    if (!projects[0]) return null;
    const { rows: members } = await query(
      `SELECT pm.role, u.id, u.first_name, u.last_name, u.email, u.avatar_url
       FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1`,
      [id],
    );
    return { ...projects[0], members };
  }

  async create(data, userId) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO projects (company_id,name,description,type,status,location,latitude,longitude,start_date,end_date,total_budget,client_name,client_email,client_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
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

// ── Material Repository ───────────────────────────────────────
class MaterialRepository extends BaseRepository {
  constructor() {
    super("materials");
  }

  async findByCompanyFiltered(
    companyId,
    { search, category, status, limit = 50, offset = 0 },
  ) {
    const conditions = ["m.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (search) {
      conditions.push(`m.name ILIKE $${i++}`);
      params.push(`%${search}%`);
    }
    if (category) {
      conditions.push(`m.category = $${i++}`);
      params.push(category);
    }
    if (status) {
      conditions.push(`m.status = $${i++}`);
      params.push(status);
    }
    params.push(limit, offset);

    const { rows } = await query(
      `SELECT m.*, s.name AS supplier_name, s.phone AS supplier_phone
       FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.name LIMIT $${i++} OFFSET $${i}`,
      params,
    );
    return rows;
  }

  async findByIdWithLedger(id, companyId) {
    const { rows: mat } = await query(
      `SELECT m.*, s.name AS supplier_name FROM materials m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.id = $1 AND m.company_id = $2`,
      [id, companyId],
    );
    if (!mat[0]) return null;
    const { rows: txs } = await query(
      `SELECT st.*, u.first_name, u.last_name, p.name AS project_name
       FROM stock_transactions st
       JOIN users u ON u.id = st.user_id
       LEFT JOIN projects p ON p.id = st.project_id
       WHERE st.material_id = $1 ORDER BY st.created_at DESC LIMIT 30`,
      [id],
    );
    return { ...mat[0], transactions: txs };
  }

  async getLowStock(companyId) {
    const { rows } = await query(
      `SELECT m.*, s.name AS supplier_name, s.phone AS supplier_phone
       FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.company_id = $1 AND m.status IN ('LOW','CRITICAL','OUT_OF_STOCK')
       ORDER BY m.quantity ASC`,
      [companyId],
    );
    return rows;
  }

  async stockIn(
    id,
    { quantity, unitCost, projectId, userId, notes, receiptUrl },
  ) {
    return withTransaction(async (client) => {
      const { rows: mat } = await client.query(
        "SELECT * FROM materials WHERE id = $1 FOR UPDATE",
        [id],
      );
      const m = mat[0];
      const newQty = parseFloat(m.quantity) + parseFloat(quantity);
      const cost = unitCost || m.unit_cost;
      const status =
        newQty <= 0
          ? "OUT_OF_STOCK"
          : newQty <= parseFloat(m.min_quantity) * 0.5
            ? "CRITICAL"
            : newQty <= parseFloat(m.min_quantity)
              ? "LOW"
              : "OK";
      const { rows: tx } = await client.query(
        `INSERT INTO stock_transactions (material_id,project_id,user_id,type,quantity,unit_cost,total_cost,quantity_before,quantity_after,notes,receipt_url)
         VALUES ($1,$2,$3,'STOCK_IN',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          id,
          projectId || null,
          userId,
          quantity,
          cost,
          parseFloat(quantity) * parseFloat(cost),
          parseFloat(m.quantity),
          newQty,
          notes || null,
          receiptUrl || null,
        ],
      );
      const { rows: updated } = await client.query(
        "UPDATE materials SET quantity=$1,unit_cost=$2,status=$3,updated_at=NOW() WHERE id=$4 RETURNING *",
        [newQty, cost, status, id],
      );
      return { transaction: tx[0], material: updated[0] };
    });
  }

  async stockOut(id, { quantity, projectId, userId, notes }) {
    return withTransaction(async (client) => {
      const { rows: mat } = await client.query(
        "SELECT * FROM materials WHERE id = $1 FOR UPDATE",
        [id],
      );
      const m = mat[0];
      if (parseFloat(quantity) > parseFloat(m.quantity))
        throw new Error(
          `Insufficient stock. Available: ${m.quantity} ${m.unit}`,
        );
      const newQty = parseFloat(m.quantity) - parseFloat(quantity);
      const status =
        newQty <= 0
          ? "OUT_OF_STOCK"
          : newQty <= parseFloat(m.min_quantity) * 0.5
            ? "CRITICAL"
            : newQty <= parseFloat(m.min_quantity)
              ? "LOW"
              : "OK";
      const { rows: tx } = await client.query(
        `INSERT INTO stock_transactions (material_id,project_id,user_id,type,quantity,unit_cost,total_cost,quantity_before,quantity_after,notes)
         VALUES ($1,$2,$3,'STOCK_OUT',$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          projectId || null,
          userId,
          quantity,
          m.unit_cost,
          parseFloat(quantity) * parseFloat(m.unit_cost),
          parseFloat(m.quantity),
          newQty,
          notes || null,
        ],
      );
      const { rows: updated } = await client.query(
        "UPDATE materials SET quantity=$1,status=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
        [newQty, status, id],
      );
      return {
        transaction: tx[0],
        material: updated[0],
        statusChanged: status !== m.status,
      };
    });
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO materials (company_id,supplier_id,name,category,unit,unit_cost,quantity,min_quantity,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.companyId,
        data.supplierId || null,
        data.name,
        data.category,
        data.unit,
        data.unitCost || 0,
        data.quantity || 0,
        data.minQuantity || 0,
        data.description || null,
      ],
    );
    return rows[0];
  }

  async update(id, data) {
    const allowed = [
      "name",
      "category",
      "unit",
      "unit_cost",
      "min_quantity",
      "supplier_id",
      "description",
      "image_url",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE materials SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }
}

// ── Equipment Repository ──────────────────────────────────────
class EquipmentRepository extends BaseRepository {
  constructor() {
    super("equipment");
  }

  async findByCompany(companyId, { status, type, search } = {}) {
    const conditions = ["e.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (status) {
      conditions.push(`e.status = $${i++}`);
      params.push(status);
    }
    if (type) {
      conditions.push(`e.type = $${i++}`);
      params.push(type);
    }
    if (search) {
      conditions.push(`e.name ILIKE $${i++}`);
      params.push(`%${search}%`);
    }
    const { rows } = await query(
      `SELECT e.*,
        (SELECT row_to_json(eu) FROM equipment_usages eu WHERE eu.equipment_id = e.id AND eu.end_time IS NULL LIMIT 1) AS active_usage
       FROM equipment e WHERE ${conditions.join(" AND ")} ORDER BY e.name`,
      params,
    );
    return rows;
  }

  async startUsage(equipmentId, { projectId, operatorId, notes }) {
    return withTransaction(async (client) => {
      await client.query(
        "UPDATE equipment SET status='IN_USE', updated_at=NOW() WHERE id=$1",
        [equipmentId],
      );
      const { rows } = await client.query(
        "INSERT INTO equipment_usages (equipment_id,project_id,operator_id,notes) VALUES ($1,$2,$3,$4) RETURNING *",
        [equipmentId, projectId, operatorId, notes || null],
      );
      return rows[0];
    });
  }

  async endUsage(usageId, equipmentId) {
    return withTransaction(async (client) => {
      const { rows: usages } = await client.query(
        "SELECT eu.*, e.rate_per_hour FROM equipment_usages eu JOIN equipment e ON e.id = eu.equipment_id WHERE eu.id=$1 AND eu.end_time IS NULL",
        [usageId],
      );
      if (!usages[0]) throw new Error("Active usage not found");
      const usage = usages[0];
      const endTime = new Date();
      const durationHrs = (endTime - usage.start_time) / 3600000;
      const totalCost = durationHrs * parseFloat(usage.rate_per_hour);
      const { rows: updated } = await client.query(
        "UPDATE equipment_usages SET end_time=$1,duration_hrs=$2,total_cost=$3 WHERE id=$4 RETURNING *",
        [
          endTime,
          Math.round(durationHrs * 100) / 100,
          Math.round(totalCost),
          usageId,
        ],
      );
      await client.query(
        "UPDATE equipment SET status='AVAILABLE', total_hours_logged=total_hours_logged+$1, updated_at=NOW() WHERE id=$2",
        [Math.round(durationHrs * 100) / 100, equipmentId],
      );
      return {
        ...updated[0],
        formatted_duration: `${Math.floor(durationHrs)}h ${Math.round((durationHrs % 1) * 60)}m`,
      };
    });
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO equipment (company_id,name,type,serial_no,rate_per_hour,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        data.companyId,
        data.name,
        data.type,
        data.serialNo || null,
        data.ratePerHour || 0,
        data.notes || null,
      ],
    );
    return rows[0];
  }

  async update(id, data) {
    const allowed = [
      "name",
      "type",
      "serial_no",
      "rate_per_hour",
      "status",
      "next_maintenance_at",
      "image_url",
      "notes",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE equipment SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }
}

// ── Budget Repository ─────────────────────────────────────────
class BudgetRepository extends BaseRepository {
  constructor() {
    super("budgets");
  }

  async getSummary(projectId) {
    const { rows: budgets } = await query(
      "SELECT * FROM budgets WHERE project_id = $1",
      [projectId],
    );
    const { rows: expenses } = await query(
      "SELECT category, SUM(amount)::numeric AS total FROM expenses WHERE project_id=$1 AND status='APPROVED' GROUP BY category",
      [projectId],
    );
    const expMap = Object.fromEntries(
      expenses.map((e) => [e.category, parseFloat(e.total)]),
    );
    const byCategory = budgets.map((b) => {
      const actual = expMap[b.category] || 0;
      const pct =
        parseFloat(b.allocated) > 0
          ? Math.round((actual / parseFloat(b.allocated)) * 100)
          : 0;
      return {
        ...b,
        actual_spent: actual,
        percent_used: pct,
        remaining: parseFloat(b.allocated) - actual,
        is_overspent: actual > parseFloat(b.allocated),
      };
    });
    const totalAllocated = byCategory.reduce(
      (s, b) => s + parseFloat(b.allocated),
      0,
    );
    const totalSpent = byCategory.reduce((s, b) => s + b.actual_spent, 0);
    return {
      by_category: byCategory,
      total_allocated: totalAllocated,
      total_spent: totalSpent,
      remaining: totalAllocated - totalSpent,
      percent_used:
        totalAllocated > 0
          ? Math.round((totalSpent / totalAllocated) * 100)
          : 0,
    };
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO budgets (project_id,category,allocated,period,start_date,end_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.projectId,
        data.category,
        data.allocated,
        data.period || null,
        data.startDate || null,
        data.endDate || null,
        data.notes || null,
      ],
    );
    return rows[0];
  }

  async updateSpent(projectId, category, amount, client) {
    const q = client || query;
    await q(
      "UPDATE budgets SET spent = spent + $1, updated_at = NOW() WHERE project_id=$2 AND category=$3",
      [amount, projectId, category],
    );
  }
}

// ── Expense Repository ────────────────────────────────────────
class ExpenseRepository extends BaseRepository {
  constructor() {
    super("expenses");
  }

  async findByCompany(companyId, { projectId, status, limit = 50 } = {}) {
    const conditions = ["p.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (projectId) {
      conditions.push(`e.project_id = $${i++}`);
      params.push(projectId);
    }
    if (status) {
      conditions.push(`e.status = $${i++}`);
      params.push(status);
    }
    params.push(Number(limit) || 50);
    const { rows } = await query(
      `SELECT e.*, u.first_name, u.last_name, p.name AS project_name
     FROM expenses e
     LEFT JOIN users u ON u.id = e.submitted_by_id
     LEFT JOIN projects p ON p.id = e.project_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.created_at DESC
     LIMIT $${i}`,
      params,
    );
    return rows;
  }

  async findFiltered(
    companyId,
    { projectId, category, status, startDate, endDate, limit = 20, offset = 0 },
  ) {
    const conditions = ["p.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (projectId) {
      conditions.push(`e.project_id = $${i++}`);
      params.push(projectId);
    }
    if (category) {
      conditions.push(`e.category = $${i++}`);
      params.push(category);
    }
    if (status) {
      conditions.push(`e.status = $${i++}`);
      params.push(status);
    }
    if (startDate) {
      conditions.push(`e.expense_date >= $${i++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`e.expense_date <= $${i++}`);
      params.push(endDate);
    }
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT e.*, u.first_name, u.last_name, p.name AS project_name
   FROM expenses e
   LEFT JOIN users u ON u.id = e.submitted_by_id
   LEFT JOIN projects p ON p.id = e.project_id
   WHERE e.project_id = ANY(
     SELECT id FROM projects WHERE company_id = $1
   )
   ORDER BY e.created_at DESC`,
      [companyId],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO expenses (project_id,budget_id,submitted_by_id,category,description,amount,status,receipt_url,expense_date,photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        data.projectId,
        data.budgetId || null,
        data.submittedById,
        data.category,
        data.description,
        data.amount,
        data.status || "PENDING",
        data.receiptUrl || null,
        data.expenseDate || new Date(),
        JSON.stringify(data.photos || []),
      ],
    );
    return rows[0];
  }

  async approve(id, approvedById) {
    const { rows } = await query(
      "UPDATE expenses SET status='APPROVED',approved_by_id=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *",
      [approvedById, id],
    );
    return rows[0];
  }

  async reject(id, reason) {
    const { rows } = await query(
      "UPDATE expenses SET status='REJECTED',rejected_reason=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [reason, id],
    );
    return rows[0];
  }
}

// ── Visitor Repository ────────────────────────────────────────
class VisitorRepository extends BaseRepository {
  constructor() {
    super("visitors");
  }

  async findByProject(projectId, { date } = {}) {
    const startOfDay = date
      ? new Date(date)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const { rows } = await query(
      `SELECT v.*, u.first_name AS logged_by_first, u.last_name AS logged_by_last
       FROM visitors v JOIN users u ON u.id = v.logged_by_id
       WHERE v.project_id=$1 AND v.time_in >= $2 AND v.time_in < $3 ORDER BY v.time_in DESC`,
      [projectId, startOfDay, endOfDay],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO visitors (project_id,logged_by_id,full_name,company,phone,email,purpose,host_name,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.projectId,
        data.loggedById,
        data.fullName,
        data.company || null,
        data.phone || null,
        data.email || null,
        data.purpose,
        data.hostName || null,
        data.notes || null,
      ],
    );
    return rows[0];
  }

  async checkout(id) {
    const { rows: v } = await query("SELECT * FROM visitors WHERE id=$1", [id]);
    if (!v[0]) return null;
    const timeOut = new Date();
    const durationMins = Math.round((timeOut - v[0].time_in) / 60000);
    const { rows } = await query(
      "UPDATE visitors SET time_out=$1,duration_mins=$2,status='CHECKED_OUT' WHERE id=$3 RETURNING *",
      [timeOut, durationMins, id],
    );
    return rows[0];
  }
}

// ── Attendance Repository ─────────────────────────────────────
class AttendanceRepository extends BaseRepository {
  constructor() {
    super("attendances");
  }

  async findTodayByUser(userId, projectId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { rows } = await query(
      "SELECT * FROM attendances WHERE user_id=$1 AND project_id=$2 AND check_in >= $3 AND check_out IS NULL LIMIT 1",
      [userId, projectId, today],
    );
    return rows[0] || null;
  }

  async checkIn(data) {
    const { rows } = await query(
      "INSERT INTO attendances (project_id,user_id,latitude,longitude,daily_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        data.projectId,
        data.userId,
        data.latitude || null,
        data.longitude || null,
        data.dailyRate || null,
      ],
    );
    return rows[0];
  }

  async checkOut(id) {
    const { rows: rec } = await query("SELECT * FROM attendances WHERE id=$1", [
      id,
    ]);
    if (!rec[0]) return null;
    const checkOut = new Date();
    const hoursWorked = (checkOut - rec[0].check_in) / 3600000;
    const totalPay = rec[0].daily_rate
      ? (hoursWorked / 8) * parseFloat(rec[0].daily_rate)
      : null;
    const { rows } = await query(
      "UPDATE attendances SET check_out=$1,hours_worked=$2,total_pay=$3 WHERE id=$4 RETURNING *",
      [
        checkOut,
        Math.round(hoursWorked * 100) / 100,
        totalPay ? Math.round(totalPay) : null,
        id,
      ],
    );
    return rows[0];
  }

  async findByProject(projectId, date) {
    const startOfDay = date
      ? new Date(date)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const { rows } = await query(
      `SELECT a.*, u.first_name, u.last_name, u.role, p.name AS project_name
       FROM attendances a JOIN users u ON u.id=a.user_id JOIN projects p ON p.id=a.project_id
       WHERE a.project_id=$1 AND a.check_in >= $2 AND a.check_in < $3 ORDER BY a.check_in DESC`,
      [projectId, startOfDay, endOfDay],
    );
    return rows;
  }
}

// ── Notification Repository ───────────────────────────────────
class NotificationRepository extends BaseRepository {
  constructor() {
    super("notifications");
  }

  async findByUser(userId, limit = 50) {
    const { rows } = await query(
      "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      "INSERT INTO notifications (user_id,title,body,type,data) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        data.userId,
        data.title,
        data.body,
        data.type || "GENERAL",
        data.data ? JSON.stringify(data.data) : null,
      ],
    );
    return rows[0];
  }

  async markAllRead(userId) {
    await query(
      "UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE",
      [userId],
    );
  }

  async markRead(id, userId) {
    await query(
      "UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
  }

  async createBulk(userIds, data) {
    for (const userId of userIds) {
      await this.create({ ...data, userId });
    }
  }
}

// ── Dashboard Repository ──────────────────────────────────────
class DashboardRepository {
  async getSummary(companyId, projectId) {
    const projectFilter = projectId ? "AND p.id = $2" : "";
    const params = projectId ? [companyId, projectId] : [companyId];

    const { rows: overview } = await query(
      `SELECT
        COUNT(DISTINCT p.id) FILTER (WHERE p.status='ACTIVE') AS active_projects,
        COALESCE(SUM(b.allocated),0)::numeric AS total_budget,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status='APPROVED'),0)::numeric AS total_spent,
        COUNT(DISTINCT m.id) FILTER (WHERE m.status IN ('LOW','CRITICAL','OUT_OF_STOCK')) AS stock_alerts,
        COUNT(DISTINCT eq.id) FILTER (WHERE eq.status='IN_USE') AS equipment_in_use
       FROM projects p
       LEFT JOIN budgets b ON b.project_id=p.id
       LEFT JOIN expenses e ON e.project_id=p.id
       LEFT JOIN materials m ON m.company_id=p.company_id
       LEFT JOIN equipment eq ON eq.company_id=p.company_id
       WHERE p.company_id=$1 ${projectFilter}`,
      params,
    );

    const { rows: weeklySpend } = await query(
      `SELECT DATE_TRUNC('day', expense_date) AS day,
              TO_CHAR(DATE_TRUNC('day',expense_date),'Dy') AS label,
              COALESCE(SUM(amount),0)::numeric AS amount
       FROM expenses e JOIN projects p ON p.id=e.project_id
       WHERE p.company_id=$1 AND e.status='APPROVED'
         AND e.expense_date >= NOW() - INTERVAL '7 days'
       GROUP BY 1,2 ORDER BY 1`,
      [companyId],
    );

    const { rows: projects } = await query(
      `SELECT p.id, p.name, p.type, p.status, p.location,
              COALESCE(SUM(b.allocated),0)::numeric AS total_allocated,
              COALESCE(SUM(ex.amount) FILTER (WHERE ex.status='APPROVED'),0)::numeric AS total_spent
       FROM projects p
       LEFT JOIN budgets b ON b.project_id=p.id
       LEFT JOIN expenses ex ON ex.project_id=p.id
       WHERE p.company_id=$1 AND p.status='ACTIVE' ${projectFilter}
       GROUP BY p.id ORDER BY p.created_at DESC`,
      params,
    );

   const { rows: recentActivity } = await query(
     `SELECT * FROM (
    -- Stock transactions
    SELECT 'stock' AS activity_type, st.type::text AS type, m.name AS entity_name,
           st.quantity::text AS quantity, m.unit, st.total_cost,
           st.created_at, u.first_name, u.last_name, p.name AS project_name,
           NULL::text AS extra
    FROM stock_transactions st
    JOIN materials m ON m.id = st.material_id
    JOIN users u ON u.id = st.user_id
    LEFT JOIN projects p ON p.id = st.project_id
    WHERE m.company_id = $1

    UNION ALL

    -- Expenses
    SELECT 'expense' AS activity_type, e.status::text AS type, e.description AS entity_name,
           e.amount::text AS quantity, 'NGN'::text AS unit, e.amount AS total_cost,
           e.created_at, u.first_name, u.last_name, p.name AS project_name,
           e.category::text AS extra
    FROM expenses e
    JOIN users u ON u.id = e.submitted_by_id
    JOIN projects p ON p.id = e.project_id
    WHERE p.company_id = $1

    UNION ALL

    -- Visitors
    SELECT 'visitor' AS activity_type, v.status::text AS type, v.full_name AS entity_name,
           '1'::text AS quantity, 'visitor'::text AS unit, NULL::numeric AS total_cost,
           v.time_in AS created_at, u.first_name, u.last_name, p.name AS project_name,
           v.purpose::text AS extra
    FROM visitors v
    JOIN users u ON u.id = v.logged_by_id
    JOIN projects p ON p.id = v.project_id
    WHERE p.company_id = $1

    UNION ALL

    -- Attendance
    SELECT 'attendance' AS activity_type, a.status::text AS type,
           CONCAT(e.first_name, ' ', e.last_name) AS entity_name,
           COALESCE(a.hours_worked::text, '0') AS quantity, 'hours'::text AS unit,
           NULL::numeric AS total_cost,
           a.check_in AS created_at, e.first_name, e.last_name, p.name AS project_name,
           NULL::text AS extra
    FROM attendances a
    JOIN employees e ON e.id = a.employee_id
    JOIN projects p ON p.id = a.project_id
    WHERE p.company_id = $1

  ) combined
  ORDER BY created_at DESC
  LIMIT 10`,
     [companyId],
   );

    return { overview: overview[0], weeklySpend, projects, recentActivity };
  }
}

// ── Sync Repository ───────────────────────────────────────────
class SyncRepository {
  async getChangesSince(companyId, since) {
    const tables = [
      { name: "materials", fields: "m.*", join: "", where: "m.company_id=$1" },
      { name: "equipment", fields: "e.*", join: "", where: "e.company_id=$1" },
      { name: "projects", fields: "p.*", join: "", where: "p.company_id=$1" },
      {
        name: "budgets",
        fields: "b.*",
        join: "JOIN projects p ON p.id=b.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "expenses",
        fields: "ex.*",
        join: "JOIN projects p ON p.id=ex.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "visitors",
        fields: "v.*",
        join: "JOIN projects p ON p.id=v.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "stock_transactions",
        fields: "st.*",
        join: "JOIN materials m ON m.id=st.material_id",
        where: "m.company_id=$1",
      },
      { name: "suppliers", fields: "s.*", join: "", where: "s.company_id=$1" },
    ];

    const changes = {};
    for (const t of tables) {
      const alias = t.name.split("_")[0][0];
      const { rows } = await query(
        `SELECT ${t.fields} FROM ${t.name} ${alias.includes(" ") ? "" : alias}
         ${t.join} WHERE ${t.where} AND ${alias}.${t.name === "stock_transactions" ? "st." : alias.charAt(0) + "."}created_at > $2
         ORDER BY created_at DESC LIMIT 500`.replace(/\bst\.\b/g, "st."),
        [companyId, since],
      );
      changes[t.name] = rows;
    }
    return changes;
  }

  async updateCursor(userId, deviceId) {
    await query(
      `INSERT INTO sync_cursors (user_id, device_id, last_pulled_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id, device_id) DO UPDATE SET last_pulled_at=NOW()`,
      [userId, deviceId],
    );
  }

  async getCursor(userId, deviceId) {
    const { rows } = await query(
      "SELECT last_pulled_at FROM sync_cursors WHERE user_id=$1 AND device_id=$2",
      [userId, deviceId],
    );
    return rows[0]?.last_pulled_at || new Date(0);
  }
}

class EmployeeRepository {
  async findByCompany(companyId, { search, status, department } = {}) {
    const conds = ["e.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (status) {
      conds.push(`e.status = $${i++}`);
      params.push(status);
    }
    if (department) {
      conds.push(`e.department = $${i++}`);
      params.push(department);
    }
    if (search) {
      conds.push(
        `(e.first_name ILIKE $${i} OR e.last_name ILIKE $${i} OR e.phone ILIKE $${i})`,
      );
      params.push(`%${search}%`);
      i++;
    }
    const { rows } = await query(
      `SELECT e.*, 
        COUNT(DISTINCT a.id) FILTER (WHERE a.check_in >= NOW() - INTERVAL '30 days') AS days_this_month,
        COALESCE(SUM(a.total_pay) FILTER (WHERE a.check_in >= NOW() - INTERVAL '30 days'),0)::numeric AS pay_this_month
       FROM employees e
       LEFT JOIN attendances a ON a.employee_id = e.id
       WHERE ${conds.join(" AND ")}
       GROUP BY e.id ORDER BY e.first_name`,
      params,
    );
    return rows;
  }

  async findById(id, companyId) {
    const { rows } = await query(
      `SELECT e.* FROM employees e WHERE e.id = $1 AND e.company_id = $2`,
      [id, companyId],
    );
    if (!rows[0]) return null;
    const { rows: docs } = await query(
      "SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC",
      [id],
    );
    return { ...rows[0], documents: docs };
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO employees (company_id,first_name,last_name,phone,email,role,department,daily_rate,pay_period,bank_name,account_number,address,emergency_name,emergency_phone,hire_date,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        data.companyId,
        data.firstName,
        data.lastName,
        data.phone || null,
        data.email || null,
        data.role || "Labourer",
        data.department || null,
        data.dailyRate || 0,
        data.payPeriod || "DAILY",
        data.bankName || null,
        data.accountNumber || null,
        data.address || null,
        data.emergencyName || null,
        data.emergencyPhone || null,
        data.hireDate || new Date(),
        data.notes || null,
      ],
    );
    return rows[0];
  }

  async update(id, data) {
    const allowed = [
      "first_name",
      "last_name",
      "phone",
      "email",
      "role",
      "department",
      "daily_rate",
      "pay_period",
      "bank_name",
      "account_number",
      "address",
      "emergency_name",
      "emergency_phone",
      "hire_date",
      "notes",
      "avatar_url",
      "status",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }

  async setStatus(id, status, terminationDate = null) {
    const { rows } = await query(
      `UPDATE employees SET status = $1, termination_date = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [status, terminationDate, id],
    );
    return rows[0];
  }

  async addDocument(employeeId, { type, name, url }) {
    const { rows } = await query(
      "INSERT INTO employee_documents (employee_id,type,name,url) VALUES ($1,$2,$3,$4) RETURNING *",
      [employeeId, type, name, url],
    );
    return rows[0];
  }

  async getPayrollSummary(companyId, year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const { rows } = await query(
      `SELECT e.id, e.first_name, e.last_name, e.role, e.department, e.daily_rate,
        COUNT(a.id)::int AS days_worked,
        COALESCE(SUM(a.hours_worked),0)::numeric AS total_hours,
        COALESCE(SUM(a.total_pay),0)::numeric AS total_pay
       FROM employees e
       LEFT JOIN attendances a ON a.employee_id = e.id AND a.check_in >= $2 AND a.check_in < $3
       WHERE e.company_id = $1 AND e.status != 'TERMINATED'
       GROUP BY e.id ORDER BY e.department, e.first_name`,
      [companyId, start, end],
    );
    return rows;
  }
}

class BillingRepository {
  async getSubscription(companyId) {
    const { rows } = await query(
      "SELECT * FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1",
      [companyId],
    );
    return rows[0] || null;
  }

  async createSubscription(data) {
    const { rows } = await query(
      `INSERT INTO subscriptions (company_id,plan,status,paystack_ref,amount)
       VALUES ($1,$2,'PENDING',$3,$4) RETURNING *`,
      [data.companyId, data.plan, data.paystackRef, data.amount],
    );
    return rows[0];
  }

  async activateSubscription(paystackRef, { subCode, expiresAt }) {
    const { rows } = await query(
      `UPDATE subscriptions SET status='ACTIVE', paystack_sub_code=$1, started_at=NOW(), expires_at=$2, updated_at=NOW()
       WHERE paystack_ref=$3 RETURNING *`,
      [subCode || null, expiresAt, paystackRef],
    );
    return rows[0];
  }

  async recordPayment(data) {
    const { rows } = await query(
      `INSERT INTO payments (company_id,subscription_id,paystack_ref,amount,status,paid_at,metadata)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6) ON CONFLICT (paystack_ref) DO NOTHING RETURNING *`,
      [
        data.companyId,
        data.subscriptionId || null,
        data.paystackRef,
        data.amount,
        data.status,
        JSON.stringify(data.metadata || {}),
      ],
    );
    return rows[0];
  }

  async getPaymentHistory(companyId) {
    const { rows } = await query(
      "SELECT * FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 20",
      [companyId],
    );
    return rows;
  }
}

module.exports = {
  userRepo: new UserRepository(),
  companyRepo: new CompanyRepository(),
  projectRepo: new ProjectRepository(),
  materialRepo: new MaterialRepository(),
  equipmentRepo: new EquipmentRepository(),
  budgetRepo: new BudgetRepository(),
  expenseRepo: new ExpenseRepository(),
  visitorRepo: new VisitorRepository(),
  attendanceRepo: new AttendanceRepository(),
  notificationRepo: new NotificationRepository(),
  dashboardRepo: new DashboardRepository(),
  syncRepo: new SyncRepository(),
  employeeRepo: new EmployeeRepository(),
  billingRepo: new BillingRepository(),
};
