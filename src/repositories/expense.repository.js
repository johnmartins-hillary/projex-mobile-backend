const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

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

module.exports = ExpenseRepository;
