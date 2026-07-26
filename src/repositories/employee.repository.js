const { query } = require("../config/database");

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

module.exports = EmployeeRepository;
