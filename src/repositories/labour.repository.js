// backend/src/repositories/labour.repository.js
const { query, withTransaction } = require("../config/database");

class LabourRepository {
  // ── Schedule LABOUR resources (the plan) ─────────────────────────────────

  async getScheduleLabour(projectId, companyId) {
    const { rows } = await query(
      `
      SELECT
        r.id, r.description AS trade,
        -- FIX: quantity is headcount (workers COUNT) on LABOUR resources
        -- since the schedule duration rework — it was never the number of
        -- days. duration_days is the real "planned days" column now
        -- (estimated_cost = quantity * duration_days * unit_cost). This
        -- query was still reading r.quantity as planned_days, so the
        -- Labour screen showed headcount mislabeled as days and had no
        -- way to show real duration at all.
        r.duration_days     AS planned_days,
        r.quantity           AS planned_headcount,
        r.unit, r.unit_cost AS day_rate,
        r.estimated_cost    AS planned_cost,
        r.actual_cost,
        t.id   AS task_id,   t.name AS task_name,
        t.start_date,        t.end_date,
        ph.id  AS phase_id,  ph.name AS phase_name,
        ph.status AS phase_status,

        -- Actual from labour logs — includes excess_amount (overtime/
        -- bonus etc.) alongside the generated total_cost column, since
        -- that column is GENERATED ALWAYS AS (headcount * day_rate) and
        -- can't itself be redefined to include it. Unfiltered by approval
        -- status here (logged = operational record of work done).
        COALESCE((
          SELECT SUM(ll.total_cost + ll.excess_amount)
          FROM project_labour_logs ll
          WHERE ll.task_resource_id = r.id
        ), 0)::NUMERIC AS logged_cost,

        COALESCE((
          SELECT SUM(ll.headcount)
          FROM project_labour_logs ll
          WHERE ll.task_resource_id = r.id
        ), 0)::INT AS logged_headcount,

        COALESCE((
          SELECT COUNT(DISTINCT ll.log_date)
          FROM project_labour_logs ll
          WHERE ll.task_resource_id = r.id
        ), 0)::INT AS logged_days

      FROM project_task_resources r
      JOIN project_tasks  t  ON t.id  = r.task_id
      JOIN project_phases ph ON ph.id = t.phase_id
      JOIN projects       p  ON p.id  = ph.project_id
      WHERE r.type        = 'LABOUR'
        AND ph.project_id = $1
        AND p.company_id  = $2
      ORDER BY ph.order_index ASC, t.start_date ASC NULLS LAST, r.description ASC
    `,
      [projectId, companyId],
    );
    return rows;
  }

  // ── Daily logs ────────────────────────────────────────────────────────────

  async getLogs(projectId, filters = {}) {
    const params = [projectId];
    const conditions = ["ll.project_id = $1"];

    if (filters.startDate) {
      params.push(filters.startDate);
      conditions.push(`ll.log_date >= $${params.length}`);
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      conditions.push(`ll.log_date <= $${params.length}`);
    }
    if (filters.trade) {
      params.push(filters.trade);
      conditions.push(`ll.trade ILIKE $${params.length}`);
    }
    if (filters.phaseId) {
      params.push(filters.phaseId);
      conditions.push(`ll.phase_id = $${params.length}`);
    }

    const { rows } = await query(
      `
      SELECT
        ll.*,
        u.first_name || ' ' || u.last_name AS recorded_by_name,
        ph.name  AS phase_name,
        t.name   AS task_name,
        r.description AS resource_trade
      FROM project_labour_logs ll
      LEFT JOIN users          u  ON u.id  = ll.recorded_by
      LEFT JOIN project_phases ph ON ph.id = ll.phase_id
      LEFT JOIN project_tasks  t  ON t.id  = ll.task_id
      LEFT JOIN project_task_resources r ON r.id = ll.task_resource_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ll.log_date DESC, ll.created_at DESC
    `,
      params,
    );
    return rows;
  }

  // ── Summary: per trade planned vs actual ─────────────────────────────────

  async getSummary(projectId, companyId) {
    // Planned from schedule
    const { rows: planned } = await query(
      `
      SELECT
        r.description                          AS trade,
        SUM(r.duration_days)::NUMERIC          AS planned_days,
        SUM(r.quantity)::NUMERIC               AS planned_headcount,
        SUM(r.estimated_cost)::NUMERIC         AS planned_cost,
        AVG(r.unit_cost)::NUMERIC              AS avg_day_rate
      FROM project_task_resources r
      JOIN project_tasks  t  ON t.id  = r.task_id
      JOIN project_phases ph ON ph.id = t.phase_id
      JOIN projects       p  ON p.id  = ph.project_id
      WHERE r.type        = 'LABOUR'
        AND ph.project_id = $1
        AND p.company_id  = $2
      GROUP BY r.description
      ORDER BY planned_cost DESC
    `,
      [projectId, companyId],
    );

    // Actual from logs — total_cost + excess_amount (see the comment in
    // getScheduleLabour above on why these are added rather than folded
    // into a single generated column).
    const { rows: actual } = await query(
      `
      SELECT
        trade,
        SUM(headcount)::INT    AS total_headcount,
        COUNT(DISTINCT log_date)::INT AS days_logged,
        SUM(total_cost + excess_amount)::NUMERIC AS actual_cost,
        AVG(day_rate)::NUMERIC   AS avg_day_rate
      FROM project_labour_logs
      WHERE project_id = $1
      GROUP BY trade
      ORDER BY actual_cost DESC
    `,
      [projectId],
    );

    // Daily totals for chart (last 14 days)
    const { rows: daily } = await query(
      `
      SELECT
        log_date,
        SUM(headcount)::INT      AS total_headcount,
        SUM(total_cost + excess_amount)::NUMERIC AS total_cost,
        json_agg(
          json_build_object(
            'trade',     trade,
            'headcount', headcount,
            'day_rate',  day_rate,
            'cost',      total_cost + excess_amount
          ) ORDER BY trade
        ) AS breakdown
      FROM project_labour_logs
      WHERE project_id = $1
        AND log_date >= CURRENT_DATE - INTERVAL '13 days'
      GROUP BY log_date
      ORDER BY log_date ASC
    `,
      [projectId],
    );

    // Merge planned + actual by trade
    const tradeMap = new Map();
    for (const p of planned) {
      tradeMap.set(p.trade, {
        trade: p.trade,
        planned_days: Number(p.planned_days || 0),
        planned_headcount: Number(p.planned_headcount || 0),
        planned_cost: Number(p.planned_cost || 0),
        avg_day_rate: Number(p.avg_day_rate || 0),
        actual_days: 0,
        actual_cost: 0,
        headcount: 0,
        variance: 0,
        source: "schedule",
      });
    }
    for (const a of actual) {
      if (tradeMap.has(a.trade)) {
        const entry = tradeMap.get(a.trade);
        entry.actual_days = a.days_logged;
        entry.actual_cost = Number(a.actual_cost || 0);
        entry.headcount = a.total_headcount;
        entry.avg_day_rate = Number(a.avg_day_rate || 0);
        entry.variance = entry.actual_cost - entry.planned_cost;
      } else {
        // Trade logged on site but not in schedule
        tradeMap.set(a.trade, {
          trade: a.trade,
          planned_days: 0,
          planned_headcount: 0,
          planned_cost: 0,
          avg_day_rate: Number(a.avg_day_rate || 0),
          actual_days: a.days_logged,
          actual_cost: Number(a.actual_cost || 0),
          headcount: a.total_headcount,
          variance: Number(a.actual_cost || 0), // all unplanned
          source: "unplanned",
        });
      }
    }

    const totalPlanned = [...tradeMap.values()].reduce(
      (s, t) => s + t.planned_cost,
      0,
    );
    const totalActual = [...tradeMap.values()].reduce(
      (s, t) => s + t.actual_cost,
      0,
    );

    return {
      by_trade: [...tradeMap.values()],
      total_planned: totalPlanned,
      total_actual: totalActual,
      variance: totalActual - totalPlanned,
      daily,
    };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createLog(projectId, companyId, userId, data) {
    // Status is always APPROVED now — under the payment-requests flow,
    // this only runs at confirmation time (paymentRequests.repository.js's
    // confirm()), after an owner has already approved the request.
    const {
      rows: [log],
    } = await query(
      `
      INSERT INTO project_labour_logs
        (project_id, company_id, phase_id, task_id, task_resource_id,
         log_date, trade, headcount, day_rate, notes, recorded_by, status,
         receipt_url, receipt_public_id, excess_amount, excess_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'APPROVED',$12,$13,$14,$15)
      RETURNING *
    `,
      [
        projectId,
        companyId,
        data.phaseId || null,
        data.taskId || null,
        data.taskResourceId || null,
        data.logDate || new Date().toISOString().split("T")[0],
        data.trade.trim(),
        data.headcount,
        data.dayRate,
        data.notes || null,
        userId,
        data.receiptUrl || null,
        data.receiptPublicId || null,
        data.excessAmount || 0,
        data.excessReason || null,
      ],
    );

    // actual_cost on the linked task resource resyncs from APPROVED logs
    // (the WHERE clause in _resyncActualCost). That's always true now —
    // a log only gets created here after the payment request behind it
    // was already approved — but the filter is left in place since it's
    // harmless and self-documenting.
    if (log.task_resource_id)
      await this._resyncActualCost(log.task_resource_id);

    return log;
  }

  async approveLog(logId, projectId, userId) {
    const {
      rows: [log],
    } = await query(
      `
      UPDATE project_labour_logs SET
        status = 'APPROVED', approved_by = $1, approved_at = NOW()
      WHERE id = $2 AND project_id = $3
      RETURNING *
    `,
      [userId, logId, projectId],
    );
    if (log?.task_resource_id)
      await this._resyncActualCost(log.task_resource_id);
    return log;
  }

  async rejectLog(logId, projectId, userId, reason) {
    const {
      rows: [log],
    } = await query(
      `
      UPDATE project_labour_logs SET
        status = 'REJECTED', approved_by = $1, approved_at = NOW(),
        rejection_reason = $2
      WHERE id = $3 AND project_id = $4
      RETURNING *
    `,
      [userId, reason || null, logId, projectId],
    );
    if (log?.task_resource_id)
      await this._resyncActualCost(log.task_resource_id);
    return log;
  }

  async _resyncActualCost(taskResourceId) {
    await query(
      `
      UPDATE project_task_resources SET
        actual_cost = (
          SELECT COALESCE(SUM(total_cost + excess_amount), 0)
          FROM project_labour_logs
          WHERE task_resource_id = $1 AND status = 'APPROVED'
        )
      WHERE id = $1
    `,
      [taskResourceId],
    );
  }

  async updateLog(logId, projectId, data) {
    const allowed = [
      "log_date",
      "trade",
      "headcount",
      "day_rate",
      "notes",
      "phase_id",
      "task_id",
      "task_resource_id",
      "receipt_url",
      "receipt_public_id",
      "excess_amount",
      "excess_reason",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;

    const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
    const {
      rows: [log],
    } = await query(
      `UPDATE project_labour_logs SET ${sets}, updated_at = NOW()
       WHERE id = $1 AND project_id = $2 RETURNING *`,
      [logId, projectId, ...fields.map((f) => data[f])],
    );

    // Re-sync actual_cost on linked resource
    if (log?.task_resource_id)
      await this._resyncActualCost(log.task_resource_id);

    return log;
  }

  async deleteLog(logId, projectId) {
    const {
      rows: [log],
    } = await query(
      `DELETE FROM project_labour_logs WHERE id=$1 AND project_id=$2 RETURNING *`,
      [logId, projectId],
    );

    // Re-sync actual_cost
    if (log?.task_resource_id)
      await this._resyncActualCost(log.task_resource_id);

    return log;
  }
}

module.exports = LabourRepository;
