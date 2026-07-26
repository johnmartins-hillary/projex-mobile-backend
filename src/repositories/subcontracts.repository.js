// backend/src/repositories/subcontracts.repository.js
const { query, withTransaction } = require("../config/database");

class SubcontractsRepository {
  // ── Schedule SUBCONTRACT resources (the plan) ─────────────────────────────

  async getScheduleSubcontracts(projectId, companyId) {
    const { rows } = await query(
      `
      SELECT
        r.id, r.description AS scope, r.quantity,
        r.unit, r.unit_cost,
        r.estimated_cost    AS planned_cost,
        r.actual_cost,
        t.id   AS task_id,   t.name AS task_name,
        t.start_date,        t.end_date,
        ph.id  AS phase_id,  ph.name AS phase_name,
        ph.status AS phase_status,

        -- Linked subcontract if any
        (SELECT s.id   FROM subcontracts s WHERE s.task_resource_id = r.id LIMIT 1) AS linked_sub_id,
        (SELECT s.company_name FROM subcontracts s WHERE s.task_resource_id = r.id LIMIT 1) AS linked_sub_name,
        (SELECT s.amount_paid  FROM subcontracts s WHERE s.task_resource_id = r.id LIMIT 1) AS linked_sub_paid,
        (SELECT s.status       FROM subcontracts s WHERE s.task_resource_id = r.id LIMIT 1) AS linked_sub_status

      FROM project_task_resources r
      JOIN project_tasks  t  ON t.id  = r.task_id
      JOIN project_phases ph ON ph.id = t.phase_id
      JOIN projects       p  ON p.id  = ph.project_id
      WHERE r.type        = 'SUBCONTRACT'
        AND ph.project_id = $1
        AND p.company_id  = $2
      ORDER BY ph.order_index ASC, t.start_date ASC NULLS LAST, r.description ASC
    `,
      [projectId, companyId],
    );
    return rows;
  }

  // ── All subcontracts for a project ────────────────────────────────────────

  async getAll(projectId, companyId) {
    const { rows } = await query(
      `
      SELECT s.*,
        p.name AS project_name,
        r.description AS resource_scope,
        r.estimated_cost AS resource_estimated_cost
      FROM subcontracts s
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN project_task_resources r ON r.id = s.task_resource_id
      WHERE s.project_id = $1
        AND p.company_id = $2
      ORDER BY s.created_at DESC
    `,
      [projectId, companyId],
    );
    return rows;
  }

  // ── Create subcontract ────────────────────────────────────────────────────

  async create(projectId, companyId, data) {
    const {
      rows: [sub],
    } = await query(
      `
      INSERT INTO subcontracts
        (project_id, company_name, contact_name, phone, email,
         scope, contract_value, retention_percentage,
         start_date, end_date, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE')
      RETURNING *
    `,
      [
        projectId,
        data.companyName,
        data.contactName || null,
        data.phone || null,
        data.email || null,
        data.scope,
        Number(data.contractValue) || 0,
        Number(data.retentionPercentage) || 5,
        data.startDate || null,
        data.endDate || null,
        data.notes || null,
      ],
    );

    // Link to schedule resource if provided (requires V36 migration)
    if (data.taskResourceId) {
      await query(
        `
        UPDATE subcontracts SET task_resource_id = $1 WHERE id = $2
      `,
        [data.taskResourceId, sub.id],
      ).catch(() => {});
    }

    // Link back to task resource
    if (sub.task_resource_id) {
      await query(
        `
        UPDATE project_task_resources
        SET actual_cost = $1
        WHERE id = $2
      `,
        [sub.contract_value, sub.task_resource_id],
      );
    }

    return sub;
  }

  // ── Milestones ────────────────────────────────────────────────────────────

  async getMilestones(subcontractId) {
    const { rows } = await query(
      `
      SELECT * FROM subcontract_milestones
      WHERE subcontract_id = $1
      ORDER BY due_date ASC NULLS LAST, created_at ASC
    `,
      [subcontractId],
    );
    return rows;
  }

  async createMilestone(subcontractId, data) {
    const {
      rows: [m],
    } = await query(
      `
      INSERT INTO subcontract_milestones
        (subcontract_id, title, description, amount, due_date, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
      RETURNING *
    `,
      [
        subcontractId,
        data.title,
        data.description || null,
        Number(data.amount) || 0,
        data.dueDate || null,
        data.notes || null,
      ],
    );
    return m;
  }

  async updateMilestone(subcontractId, milestoneId, data) {
    const allowed = [
      "status",
      "title",
      "description",
      "amount",
      "due_date",
      "notes",
      "completed_date",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
    const {
      rows: [m],
    } = await query(
      `UPDATE subcontract_milestones SET ${sets}, updated_at = NOW()
       WHERE id = $1 AND subcontract_id = $2 RETURNING *`,
      [milestoneId, subcontractId, ...fields.map((f) => data[f])],
    );
    return m;
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  async getPayments(subcontractId) {
    const { rows } = await query(
      `
      SELECT sp.*,
        sm.title AS milestone_title
      FROM subcontract_payments sp
      LEFT JOIN subcontract_milestones sm ON sm.id = sp.milestone_id
      WHERE sp.subcontract_id = $1
      ORDER BY sp.payment_date DESC, sp.created_at DESC
    `,
      [subcontractId],
    );

    // Enrich with recorded_by name if column exists (added in V37)
    const enriched = await Promise.all(
      rows.map(async (row) => {
        if (!row.recorded_by)
          return { ...row, first_name: null, last_name: null };
        const {
          rows: [u],
        } = await query(
          `SELECT first_name, last_name FROM users WHERE id = $1`,
          [row.recorded_by],
        ).catch(() => ({ rows: [{}] }));
        return {
          ...row,
          first_name: u?.first_name || null,
          last_name: u?.last_name || null,
        };
      }),
    );

    return enriched;
  }

  async createPayment(subcontractId, userId, data) {
    const result = await withTransaction(async (client) => {
      // Status is always APPROVED now. Under the payment-requests flow,
      // this only runs at confirmation time — after an owner has already
      // approved the request in payment_requests — so there's no more
      // PENDING state possible at this table's level.
      const {
        rows: [payment],
      } = await client.query(
        `
        INSERT INTO subcontract_payments
          (subcontract_id, amount, payment_date, payment_method,
           reference, milestone_id, notes, status, receipt_url, receipt_public_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8,$9)
        RETURNING *
      `,
        [
          subcontractId,
          Number(data.amount),
          data.paymentDate || new Date().toISOString().split("T")[0],
          data.paymentMethod || "BANK_TRANSFER",
          data.reference || null,
          data.milestoneId || null,
          data.notes || null,
          data.receiptUrl || null,
          data.receiptPublicId || null,
        ],
      );

      // recorded_by set after transaction (column added in V37)

      // Milestone marked PAID immediately — a workflow/tracking state
      // ("this milestone has a payment recorded against it"), not a
      // separate financial-approval concern; the payment itself is
      // already approved by the time this runs.
      if (payment.milestone_id) {
        await client.query(
          `
          UPDATE subcontract_milestones SET status = 'PAID', updated_at = NOW()
          WHERE id = $1
        `,
          [payment.milestone_id],
        );
      }

      return payment;
    });

    // Set recorded_by outside transaction so a missing column doesn't abort payment
    await query(
      `UPDATE subcontract_payments SET recorded_by = $1 WHERE id = $2`,
      [userId, result.id],
    ).catch(() => {});

    // Since this payment is already approved by construction now, sync
    // amount_paid / actual_cost immediately rather than waiting for a
    // separate approve step that no longer exists at this table's level.
    await this.resyncAmountPaid(subcontractId);

    return result;
  }

  // Attach or replace a receipt on an existing payment. Blocked once the
  // payment is REJECTED — same guard as store.repository.js's
  // attachStockInReceipt. No project_id column on subcontract_payments
  // itself, so this reaches it via subcontracts.project_id like every
  // other query against this table in this file.
  async attachPaymentReceipt(
    paymentId,
    projectId,
    receiptUrl,
    receiptPublicId,
  ) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE subcontract_payments sp SET
        receipt_url = $1, receipt_public_id = $2
      FROM subcontracts s
      WHERE sp.subcontract_id = s.id
        AND sp.id = $3 AND s.project_id = $4
        AND sp.status != 'REJECTED'
      RETURNING sp.*
    `,
      [receiptUrl, receiptPublicId, paymentId, projectId],
    );
    return row;
  }

  // Recomputes amount_paid from APPROVED payments only, then syncs the
  // linked task resource's actual_cost from that. Called right after
  // createPayment used to do this unconditionally; now called from the
  // payment-approval flow (paymentRequests.repository.js) once a payment
  // is actually approved or rejected, so the two states can't drift.
  async resyncAmountPaid(subcontractId) {
    const {
      rows: [sub],
    } = await query(
      `
      UPDATE subcontracts SET
        amount_paid = (
          SELECT COALESCE(SUM(amount), 0)
          FROM subcontract_payments
          WHERE subcontract_id = $1 AND status = 'APPROVED'
        ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
      [subcontractId],
    );

    if (sub?.task_resource_id) {
      await query(
        `UPDATE project_task_resources SET actual_cost = $1 WHERE id = $2`,
        [sub.amount_paid, sub.task_resource_id],
      );
    }

    return sub;
  }

  // ── Release retention ─────────────────────────────────────────────────────

  async releaseRetention(subcontractId) {
    const {
      rows: [sub],
    } = await query(
      `
      UPDATE subcontracts SET
        retention_released    = TRUE,
        retention_released_at = NOW(),
        updated_at            = NOW()
      WHERE id = $1 RETURNING *
    `,
      [subcontractId],
    );
    return sub;
  }
}

module.exports = SubcontractsRepository;
