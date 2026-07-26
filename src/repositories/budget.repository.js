// backend/src/repositories/budget.repository.js
const { query } = require("../config/database");

class BudgetRepository {
  async getProjectBudget(projectId, companyId) {
    // ── 1. Project ─────────────────────────────────────────────────────
    const {
      rows: [project],
    } = await query(
      `
      SELECT
        p.id, p.name, p.status,
        COALESCE(p.total_budget, 0)::NUMERIC               AS budgeted,
        COALESCE(p.schedule_estimated_budget, 0)::NUMERIC  AS schedule_estimate
      FROM projects p
      WHERE p.id = $1 AND p.company_id = $2
    `,
      [projectId, companyId],
    );
    if (!project) return null;

    const budgeted = Number(project.budgeted);
    const scheduleEst = Number(project.schedule_estimate);
    // Formal budget ceiling = highest of the two
    const totalBudget = Math.max(budgeted, scheduleEst);

    // ── 2. Actual spend ────────────────────────────────────────────────
    // FIX: was reading from stock_transactions, a legacy table tied to
    // the pre-store `materials` schema. Nothing writes to it anymore —
    // the trigger that used to (trg_material_request_approved) was
    // dropped for referencing the dead materials/material_id columns,
    // and real stock-ins have always gone through store_stock_in
    // (StoreRepository.recordStockIn), never stock_transactions. This is
    // why materials bought through the Store screen weren't showing up
    // here despite updating stock correctly.
    const {
      rows: [stockRow],
    } = await query(
      `
      SELECT COALESCE(SUM(total_cost), 0)::NUMERIC AS v
      FROM store_stock_in
      WHERE project_id = $1 AND status = 'APPROVED'
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    const {
      rows: [expRow],
    } = await query(
      `
      SELECT COALESCE(SUM(amount), 0)::NUMERIC AS v
      FROM expenses
      WHERE project_id = $1 AND status = 'APPROVED'
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    const {
      rows: [labRow],
    } = await query(
      `
      SELECT COALESCE(SUM(
        (COALESCE(mon_hours,0)+COALESCE(tue_hours,0)+COALESCE(wed_hours,0)+
         COALESCE(thu_hours,0)+COALESCE(fri_hours,0)+COALESCE(sat_hours,0)+
         COALESCE(sun_hours,0)) * COALESCE(daily_rate,0) / 8
      ), 0)::NUMERIC AS v
      FROM timesheets
      WHERE project_id = $1 AND status = 'APPROVED'
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    // Project labourer logs (casual workers — separate from employee timesheets)
    // total_cost + excess_amount: total_cost is a GENERATED column
    // (headcount * day_rate) so excess (overtime/bonus) can't be folded
    // into it directly — added here instead.
    const {
      rows: [labourLogRow],
    } = await query(
      `
      SELECT COALESCE(SUM(total_cost + excess_amount), 0)::NUMERIC AS v
      FROM project_labour_logs
      WHERE project_id = $1 AND status = 'APPROVED'
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    // Subcontract payments
    const {
      rows: [subcontractRow],
    } = await query(
      `
      SELECT COALESCE(SUM(sp.amount), 0)::NUMERIC AS v
      FROM subcontract_payments sp
      JOIN subcontracts s ON s.id = sp.subcontract_id
      WHERE s.project_id = $1 AND sp.status = 'APPROVED'
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    const stockSpend = Number(stockRow.v || 0);
    const expenseSpend = Number(expRow.v || 0);
    const timesheetSpend = Number(labRow.v || 0);
    const labourLogSpend = Number(labourLogRow.v || 0);
    const subcontractSpend = Number(subcontractRow.v || 0);
    const labourSpend = timesheetSpend + labourLogSpend;
    const totalSpent =
      stockSpend + expenseSpend + labourSpend + subcontractSpend;

    // ── Ring % logic ────────────────────────────────────────────────────
    // Use scheduleEst as the denominator when available (more meaningful
    // than dividing a small spend by the entire project budget).
    // Fall back to totalBudget if no schedule estimate exists.
    const ringBase = scheduleEst > 0 ? scheduleEst : totalBudget;
    const overallPct =
      ringBase > 0
        ? Math.min(Math.round((totalSpent / ringBase) * 100), 100)
        : 0;
    const budgetPct =
      totalBudget > 0
        ? Math.min(Math.round((totalSpent / totalBudget) * 100), 100)
        : 0;

    const remaining = Math.max(totalBudget - totalSpent, 0);
    const status =
      budgetPct >= 90 ? "CRITICAL" : budgetPct >= 75 ? "WARNING" : "OK";

    // ── 3. Resources by type ────────────────────────────────────────────
    // estimated = from schedule resources
    const { rows: estRows } = await query(
      `
      SELECT type, COALESCE(SUM(estimated_cost), 0)::NUMERIC AS estimated
      FROM project_task_resources
      WHERE project_id = $1
      GROUP BY type
    `,
      [projectId],
    ).catch(() => ({ rows: [] }));

    // Equipment spend from expenses by category
    const {
      rows: [eqRow],
    } = await query(
      `
      SELECT COALESCE(SUM(amount), 0)::NUMERIC AS v FROM expenses
      WHERE project_id = $1 AND status = 'APPROVED'
        AND (LOWER(category) LIKE '%equipment%' OR LOWER(category) LIKE '%plant%'
          OR LOWER(category) LIKE '%machine%'  OR LOWER(category) LIKE '%hire%')
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    // Subcontract spend from expenses by category
    const {
      rows: [subRow],
    } = await query(
      `
      SELECT COALESCE(SUM(amount), 0)::NUMERIC AS v FROM expenses
      WHERE project_id = $1 AND status = 'APPROVED'
        AND (LOWER(category) LIKE '%sub%' OR LOWER(category) LIKE '%contractor%'
          OR LOWER(category) LIKE '%outsourc%')
    `,
      [projectId],
    ).catch(() => ({ rows: [{ v: 0 }] }));

    // Build the map
    const map = {};
    for (const r of estRows) {
      map[r.type] = { estimated: Number(r.estimated), actual: 0 };
    }
    // Always include MATERIAL and LABOUR if they have real spend
    if (!map.MATERIAL) map.MATERIAL = { estimated: 0, actual: 0 };
    if (!map.LABOUR) map.LABOUR = { estimated: 0, actual: 0 };
    if (!map.EQUIPMENT) map.EQUIPMENT = { estimated: 0, actual: 0 };
    if (!map.SUBCONTRACT) map.SUBCONTRACT = { estimated: 0, actual: 0 };

    map.MATERIAL.actual = stockSpend;
    map.LABOUR.actual = labourSpend;
    map.EQUIPMENT.actual = Number(eqRow.v || 0);
    map.SUBCONTRACT.actual = Number(subRow.v || 0);

    const TYPE_ORDER = ["LABOUR", "MATERIAL", "EQUIPMENT", "SUBCONTRACT"];
    const byType = TYPE_ORDER.filter(
      (t) => map[t].estimated > 0 || map[t].actual > 0,
    ).map((t) => ({
      type: t,
      estimated: map[t].estimated,
      actual: map[t].actual,
    }));

    // ── 4. Phases ───────────────────────────────────────────────────────
    // estimated from schedule; actual distributed proportionally from real spend
    // (task-level tagging is optional, so we always use the proportional fallback)
    const { rows: phaseRows } = await query(
      `
      SELECT
        ph.name,
        COALESCE(ph.estimated_cost, 0)::NUMERIC AS estimated
      FROM project_phases ph
      WHERE ph.project_id = $1 AND ph.parent_phase_id IS NULL
      ORDER BY ph.order_index ASC
    `,
      [projectId],
    ).catch(() => ({ rows: [] }));

    const totalPhaseEst = phaseRows.reduce(
      (s, r) => s + Number(r.estimated),
      0,
    );

    const phases = phaseRows.map((ph) => {
      const est = Number(ph.estimated);
      // Distribute totalSpent proportionally by each phase's estimated weight
      const actual =
        totalPhaseEst > 0 && est > 0 ? (est / totalPhaseEst) * totalSpent : 0;
      return { name: ph.name, estimated: est, actual };
    });

    // ── 5. Trend ────────────────────────────────────────────────────────
    const { rows: trend } = await query(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', expense_date), 'Mon YYYY') AS month,
        DATE_TRUNC('month', expense_date)                       AS month_date,
        COALESCE(SUM(amount), 0)::NUMERIC                       AS total
      FROM expenses
      WHERE project_id = $1 AND status = 'APPROVED'
        AND expense_date >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', expense_date)
      ORDER BY month_date ASC
    `,
      [projectId],
    ).catch(() => ({ rows: [] }));

    // ── Weekly spend (last 7 days, expenses + stock-in) ─────────────────
    const { rows: weeklyRows } = await query(
      `
      SELECT
        day,
        EXTRACT(DOW FROM day)::INT                                     AS day_of_week,
        SUM(expense_amount)::NUMERIC                                   AS expense_amount,
        SUM(stock_amount)::NUMERIC                                     AS stock_amount,
        SUM(labour_amount)::NUMERIC                                                    AS labour_amount,
        SUM(subcontract_amount)::NUMERIC                                               AS subcontract_amount,
        SUM(expense_amount + stock_amount + labour_amount + subcontract_amount)::NUMERIC AS amount
      FROM (
        SELECT
          DATE(e.expense_date)        AS day,
          COALESCE(e.amount, 0)       AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM expenses e
        WHERE e.project_id = $1
          AND e.status = 'APPROVED'
          AND e.expense_date >= CURRENT_DATE - INTERVAL '6 days'

        UNION ALL

        -- FIX: was stock_transactions (dead table) — now store_stock_in.
        SELECT
          DATE(st.created_at)         AS day,
          0::NUMERIC                  AS expense_amount,
          COALESCE(st.total_cost, 0)  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM store_stock_in st
        WHERE st.project_id = $1
          AND st.status = 'APPROVED'
          AND DATE(st.created_at) >= CURRENT_DATE - INTERVAL '6 days'

        UNION ALL

        SELECT
          DATE(ll.log_date)           AS day,
          0::NUMERIC                  AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          COALESCE(ll.total_cost + ll.excess_amount, 0)  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM project_labour_logs ll
        WHERE ll.project_id = $1
          AND ll.status = 'APPROVED'
          AND DATE(ll.log_date) >= CURRENT_DATE - INTERVAL '6 days'

        UNION ALL

        SELECT
          DATE(sp.payment_date)       AS day,
          0::NUMERIC                  AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          COALESCE(sp.amount, 0)      AS subcontract_amount
        FROM subcontract_payments sp
        JOIN subcontracts s ON s.id = sp.subcontract_id
        WHERE s.project_id = $1
          AND sp.status = 'APPROVED'
          AND DATE(sp.payment_date) >= CURRENT_DATE - INTERVAL '6 days'
      ) combined
      GROUP BY day
      ORDER BY day ASC
    `,
      [projectId],
    ).catch(() => ({ rows: [] }));

    // Fill all 7 days
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklySpend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dayStr = `${y}-${mo}-${day}`;
      const existing = weeklyRows.find((r) => {
        const raw = r.day;
        let rStr;
        if (raw instanceof Date) {
          rStr = `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
        } else {
          rStr = String(raw).split("T")[0];
        }
        return rStr === dayStr;
      });
      return {
        label: dayNames[d.getDay()],
        day_of_week: d.getDay(),
        day: dayStr,
        amount: Number(existing?.amount || 0),
        expense_amount: Number(existing?.expense_amount || 0),
        stock_amount: Number(existing?.stock_amount || 0),
        labour_amount: Number(existing?.labour_amount || 0),
        subcontract_amount: Number(existing?.subcontract_amount || 0),
      };
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        totalBudget,
        budgeted,
        scheduleEstimate: scheduleEst,
      },
      summary: {
        totalBudget,
        budgeted,
        scheduleEstimate: scheduleEst,
        totalSpent,
        remaining,
        overallPct,
        budgetPct,
        expenseSpend,
        stockSpend,
        labourSpend,
        subcontractSpend,
        ringBase,
        status,
      },
      byType,
      phases,
      trend,
      weeklySpend,
    };
  }

  // ── All projects ────────────────────────────────────────────────────────
  async getAllProjectsBudgetHealth(companyId) {
    const { rows } = await query(
      `
      SELECT
        p.id, p.name,
        p.status                                              AS project_status,
        GREATEST(
          COALESCE(p.total_budget,0),
          COALESCE(p.schedule_estimated_budget,0)
        )::NUMERIC                                            AS total_budget,
        COALESCE(p.total_budget,0)::NUMERIC                  AS budgeted,
        COALESCE(p.schedule_estimated_budget,0)::NUMERIC     AS schedule_estimate,
        COALESCE((
          SELECT SUM(amount) FROM expenses e
          WHERE e.project_id=p.id AND e.status='APPROVED'
        ),0)::NUMERIC +
        COALESCE((
          -- FIX: was stock_transactions (dead table) — now store_stock_in.
          SELECT SUM(total_cost) FROM store_stock_in st
          WHERE st.project_id=p.id AND st.status='APPROVED'
        ),0)::NUMERIC +
        COALESCE((
          SELECT SUM(
            (COALESCE(mon_hours,0)+COALESCE(tue_hours,0)+COALESCE(wed_hours,0)+
             COALESCE(thu_hours,0)+COALESCE(fri_hours,0)+COALESCE(sat_hours,0)+
             COALESCE(sun_hours,0)) * COALESCE(daily_rate,0) / 8
          ) FROM timesheets ts WHERE ts.project_id=p.id AND ts.status='APPROVED'
        ),0)::NUMERIC                                         AS total_spent
      FROM projects p
      WHERE p.company_id=$1 AND p.status NOT IN ('COMPLETED','ARCHIVED')
      ORDER BY p.created_at DESC
    `,
      [companyId],
    );

    return rows.map((r) => {
      const budget = Number(r.total_budget);
      const spent = Number(r.total_spent);
      const est = Number(r.schedule_estimate);
      const base = est > 0 ? est : budget;
      return {
        ...r,
        total_budget: budget,
        total_spent: spent,
        pct_used:
          base > 0 ? Math.min(Math.round((spent / base) * 100), 100) : 0,
      };
    });
  }

  // ── Company summary ─────────────────────────────────────────────────────
  async getCompanySummary(companyId) {
    const {
      rows: [row],
    } = await query(
      `
      SELECT
        COUNT(DISTINCT p.id)::INT AS active_projects,
        SUM(GREATEST(
          COALESCE(p.total_budget,0),
          COALESCE(p.schedule_estimated_budget,0)
        ))::NUMERIC AS total_budget,
        (COALESCE((
          SELECT SUM(e.amount) FROM expenses e JOIN projects p2 ON p2.id=e.project_id
          WHERE p2.company_id=$1 AND e.status='APPROVED'
            AND p2.status NOT IN ('COMPLETED','ARCHIVED')
        ),0) +
        COALESCE((
          -- FIX: was stock_transactions (dead table) — now store_stock_in.
          SELECT SUM(st.total_cost) FROM store_stock_in st JOIN projects p3 ON p3.id=st.project_id
          WHERE p3.company_id=$1 AND st.status='APPROVED'
            AND p3.status NOT IN ('COMPLETED','ARCHIVED')
        ),0) +
        COALESCE((
          SELECT SUM(
            (COALESCE(ts.mon_hours,0)+COALESCE(ts.tue_hours,0)+COALESCE(ts.wed_hours,0)+
             COALESCE(ts.thu_hours,0)+COALESCE(ts.fri_hours,0)+COALESCE(ts.sat_hours,0)+
             COALESCE(ts.sun_hours,0))*COALESCE(ts.daily_rate,0)/8
          ) FROM timesheets ts JOIN projects p4 ON p4.id=ts.project_id
          WHERE p4.company_id=$1 AND ts.status='APPROVED'
            AND p4.status NOT IN ('COMPLETED','ARCHIVED')
        ),0))::NUMERIC AS total_spent
      FROM projects p
      WHERE p.company_id=$1 AND p.status NOT IN ('COMPLETED','ARCHIVED')
    `,
      [companyId],
    );

    const totalBudget = Number(row?.total_budget || 0);
    const totalSpent = Number(row?.total_spent || 0);
    const overallPct =
      totalBudget > 0
        ? Math.min(Math.round((totalSpent / totalBudget) * 100), 100)
        : 0;
    return {
      activeProjects: row?.active_projects || 0,
      totalBudget,
      totalSpent,
      totalRemaining: Math.max(totalBudget - totalSpent, 0),
      overallPct,
      status:
        overallPct >= 90 ? "CRITICAL" : overallPct >= 75 ? "WARNING" : "OK",
    };
  }
}

module.exports = BudgetRepository;
