const { query } = require("../config/database");
const PaymentRequestsRepository = require("./paymentRequests.repository");

const paymentRequestsRepo = new PaymentRequestsRepository();

class DashboardRepository {
  async getOverview(companyId, projectId) {
    const pFilter = projectId ? `AND p.id = '${projectId}'` : "";
    const pFilterLL = projectId ? `AND ll.project_id = '${projectId}'` : "";
    const pFilterSub = projectId ? `AND s.project_id = '${projectId}'` : "";

    // Total budget from projects table (not a budgets table)
    const {
      rows: [budget],
    } = await query(
      `
      SELECT COALESCE(SUM(p.total_budget), 0)::NUMERIC AS total_budget
      FROM projects p
      WHERE p.company_id = $1 ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ total_budget: 0 }] }));

    const {
      rows: [proj],
    } = await query(
      `
      SELECT COUNT(*)::INT AS active_projects
      FROM projects
      WHERE company_id = $1 AND status = 'ACTIVE'
    `,
      [companyId],
    ).catch(() => ({ rows: [{ active_projects: 0 }] }));

    // Approved expenses
    const {
      rows: [spent],
    } = await query(
      `
      SELECT COALESCE(SUM(e.amount), 0)::NUMERIC AS total_spent
      FROM expenses e
      JOIN projects p ON p.id = e.project_id
      WHERE p.company_id = $1
        AND e.status = 'APPROVED'
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ total_spent: 0 }] }));

    // Stock-in (materials received) — FIX: was reading from
    // stock_transactions, a legacy table that nothing writes to anymore
    // (it belonged to the pre-store `materials` system; the trigger that
    // used to populate it — trg_material_request_approved — was dropped
    // for referencing the dead materials/material_id schema). Real
    // stock-ins go through store_stock_in now.
    const {
      rows: [stockSpend],
    } = await query(
      `
      SELECT COALESCE(SUM(st.total_cost), 0)::NUMERIC AS stock_spend
      FROM store_stock_in st
      JOIN projects p ON p.id = st.project_id
      WHERE p.company_id = $1
        AND st.status = 'APPROVED'
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ stock_spend: 0 }] }));

    // Labour logs (casual project workers) — total_cost + excess_amount,
    // since total_cost is GENERATED (headcount * day_rate) and can't
    // include excess (overtime/bonus) directly.
    const {
      rows: [labourLogSpend],
    } = await query(
      `
      SELECT COALESCE(SUM(ll.total_cost + ll.excess_amount), 0)::NUMERIC AS labour_spend
      FROM project_labour_logs ll
      JOIN projects p ON p.id = ll.project_id
      WHERE p.company_id = $1
        AND ll.status = 'APPROVED'
        ${pFilterLL}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ labour_spend: 0 }] }));

    // Subcontract payments
    const {
      rows: [subcontractSpend],
    } = await query(
      `
      SELECT COALESCE(SUM(sp.amount), 0)::NUMERIC AS subcontract_spend
      FROM subcontract_payments sp
      JOIN subcontracts s ON s.id = sp.subcontract_id
      JOIN projects p     ON p.id = s.project_id
      WHERE p.company_id = $1
        AND sp.status = 'APPROVED'
        ${pFilterSub}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ subcontract_spend: 0 }] }));

    const {
      rows: [emp],
    } = await query(
      `
      SELECT COUNT(*)::INT AS total_employees
      FROM employees
      WHERE company_id = $1 AND status = 'ACTIVE'
    `,
      [companyId],
    );

    // FIX: was reading from the dead `materials` table (flagged last
    // time as a separate issue from the stock_transactions spend bug —
    // now fixed too). project_store is project-scoped, so company-wide
    // counts need a join to projects; the low-stock threshold logic
    // mirrors store.repository.js's getStoreSummary (current_qty -
    // reserved_qty compared against min_stock_level).
    const {
      rows: [stock],
    } = await query(
      `
      SELECT
        COUNT(*)::INT AS total_materials,
        COUNT(*) FILTER (
          WHERE (ps.current_qty - ps.reserved_qty) < ps.min_stock_level
            AND ps.min_stock_level > 0
        )::INT AS low_stock,
        COUNT(*) FILTER (
          WHERE (ps.current_qty - ps.reserved_qty) <= 0
        )::INT AS out_of_stock,
        COUNT(*) FILTER (
          WHERE (
            (ps.current_qty - ps.reserved_qty) < ps.min_stock_level
            AND ps.min_stock_level > 0
          ) OR (ps.current_qty - ps.reserved_qty) <= 0
        )::INT AS stock_alerts
      FROM project_store ps
      JOIN projects p ON p.id = ps.project_id
      WHERE p.company_id = $1 ${pFilter.replace("p.id", "ps.project_id")}
    `,
      [companyId],
    ).catch(() => ({
      rows: [
        {
          total_materials: 0,
          low_stock: 0,
          out_of_stock: 0,
          stock_alerts: 0,
        },
      ],
    }));

    const {
      rows: [equip],
    } = await query(
      `
      SELECT
        COUNT(*)::INT                                AS total_equipment,
        COUNT(*) FILTER (WHERE status='IN_USE')::INT AS equipment_in_use
      FROM equipment
      WHERE company_id = $1
    `,
      [companyId],
    );

    const {
      rows: [att],
    } = await query(
      `
      SELECT
        COUNT(*)::INT                                      AS attendance_today,
        COUNT(*) FILTER (WHERE a.check_out IS NULL)::INT   AS still_on_site
      FROM attendances a
      JOIN projects p ON p.id = a.project_id
      WHERE p.company_id = $1
        AND DATE(a.check_in) = CURRENT_DATE
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ attendance_today: 0, still_on_site: 0 }] }));

    const {
      rows: [vis],
    } = await query(
      `
      SELECT COUNT(*)::INT AS visitors_today
      FROM visitors v
      JOIN projects p ON p.id = v.project_id
      WHERE p.company_id = $1
        AND DATE(v.time_in) = CURRENT_DATE
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ visitors_today: 0 }] }));

    const {
      rows: [reqs],
    } = await query(
      `
      SELECT COUNT(*)::INT AS pending_requests
      FROM material_requests mr
      JOIN projects p ON p.id = mr.project_id
      WHERE p.company_id = $1
        AND mr.status = 'PENDING'
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ pending_requests: 0 }] }));

    // Pending payment requests (stock-in / labour / subcontract payments
    // awaiting owner approval) — surfaced on the dashboard per the
    // payment-approval workflow.
    const pendingPayments = await paymentRequestsRepo
      .getPendingRequests(companyId, projectId)
      .catch(() => []);

    const lowStockItems = await this.getLowStockItems(
      companyId,
      projectId,
    ).catch(() => []);

    return {
      total_budget: Number(budget?.total_budget || 0),
      total_allocated: Number(budget?.total_allocated || 0),
      total_spent: Number(spent?.total_spent || 0),
      stock_spend: Number(stockSpend?.stock_spend || 0),
      labour_spend: Number(labourLogSpend?.labour_spend || 0),
      subcontract_spend: Number(subcontractSpend?.subcontract_spend || 0),
      active_projects: proj?.active_projects || 0,
      total_employees: emp?.total_employees || 0,
      total_materials: stock?.total_materials || 0,
      low_stock: stock?.low_stock || 0,
      out_of_stock: stock?.out_of_stock || 0,
      stock_alerts: stock?.stock_alerts || 0,
      total_equipment: equip?.total_equipment || 0,
      equipment_in_use: equip?.equipment_in_use || 0,
      attendance_today: att?.attendance_today || 0,
      still_on_site: att?.still_on_site || 0,
      visitors_today: vis?.visitors_today || 0,
      pending_requests: reqs?.pending_requests || 0,
      pending_payment_requests: pendingPayments.length,
      pending_payment_amount: pendingPayments.reduce(
        (s, r) => s + Number(r.amount || 0),
        0,
      ),
      low_stock_items: lowStockItems,
      active_workers: att?.attendance_today || 0,
    };
  }

  async getScheduleData(projectId) {
    if (!projectId) return null;

    const { rows: phases } = await query(
      `
      SELECT
        ph.id, ph.name, ph.weight, ph.status,
        ph.is_milestone, ph.estimated_cost, ph.actual_cost,
        (
          SELECT COUNT(*)::INT
          FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = ph.project_id
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases WHERE parent_phase_id = ph.id
              )
            )
        ) AS total_tasks,
        (
          SELECT COUNT(*)::INT
          FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = ph.project_id
            AND t2.status = 'COMPLETED'
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases WHERE parent_phase_id = ph.id
              )
            )
        ) AS completed_tasks,
        (
          SELECT COALESCE(ROUND(AVG(t2.progress_pct)), 0)::INT
          FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = ph.project_id
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases WHERE parent_phase_id = ph.id
              )
            )
        ) AS avg_progress_pct
      FROM project_phases ph
      WHERE ph.project_id = $1
        AND ph.parent_phase_id IS NULL
      ORDER BY ph.order_index ASC
    `,
      [projectId],
    ).catch(() => ({ rows: [] }));

    if (!phases.length) return null;

    const enriched = phases.map((ph) => {
      let progress = 0;
      if (ph.is_milestone) {
        progress = ph.status === "COMPLETED" ? 100 : 0;
      } else if (ph.total_tasks === 0) {
        progress = ph.status === "COMPLETED" ? 100 : 0;
      } else if (
        ph.avg_progress_pct !== null &&
        ph.avg_progress_pct !== undefined
      ) {
        // Use AVG(progress_pct) from task-level progress entries
        progress = Math.round(Number(ph.avg_progress_pct));
      } else {
        // Fallback: completion count (before V39 migration)
        progress = Math.round((ph.completed_tasks / ph.total_tasks) * 100);
      }
      return { ...ph, phase_progress: progress };
    });

    // Overall progress = simple average of all top-level phase progress
    // Weight is no longer used for progress calculation
    const overall_progress =
      enriched.length > 0
        ? Math.min(
            Math.round(
              enriched.reduce((s, p) => s + p.phase_progress, 0) /
                enriched.length,
            ),
            100,
          )
        : 0;

    const currentPhase =
      enriched.find((p) => p.status === "IN_PROGRESS") ||
      enriched.find((p) => p.status === "PENDING");

    const {
      rows: [taskCounts],
    } = await query(
      `
      SELECT
        COUNT(*)::INT                                          AS total_tasks,
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED')::INT   AS done_tasks,
        COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')::INT AS active_tasks,
        COUNT(*) FILTER (
          WHERE t.status != 'COMPLETED'
            AND t.end_date IS NOT NULL
            AND t.end_date < CURRENT_DATE
        )::INT                                                 AS delayed_tasks
      FROM project_tasks t
      JOIN project_phases ph ON ph.id = t.phase_id
      WHERE ph.project_id = $1
    `,
      [projectId],
    ).catch(() => ({
      rows: [
        { total_tasks: 0, done_tasks: 0, active_tasks: 0, delayed_tasks: 0 },
      ],
    }));

    const {
      rows: [proj],
    } = await query(
      `
      SELECT schedule_estimated_budget, budget_override
      FROM projects WHERE id = $1
    `,
      [projectId],
    ).catch(() => ({ rows: [{}] }));

    const estimated_budget = Number(proj?.schedule_estimated_budget || 0);
    const total_budget = Number(proj?.budget_override || estimated_budget);

    const {
      rows: [costRow],
    } = await query(
      `
      SELECT COALESCE(SUM(actual_cost), 0)::NUMERIC AS actual_cost
      FROM project_task_resources
      WHERE project_id = $1
    `,
      [projectId],
    ).catch(() => ({ rows: [{ actual_cost: 0 }] }));

    return {
      overall_progress,
      estimated_budget,
      total_budget,
      actual_cost: Number(costRow?.actual_cost || 0),
      current_phase: currentPhase || null,
      phases: enriched,
      total_tasks: taskCounts?.total_tasks || 0,
      done_tasks: taskCounts?.done_tasks || 0,
      active_tasks: taskCounts?.active_tasks || 0,
      delayed_tasks: taskCounts?.delayed_tasks || 0,
    };
  }

  async getWorkforce(companyId, projectId) {
    const pFilter = projectId ? `AND a.project_id = '${projectId}'` : "";

    const {
      rows: [row],
    } = await query(
      `
      SELECT
        COUNT(DISTINCT e.id)::INT AS total,
        COUNT(DISTINCT a.employee_id) FILTER (
          WHERE DATE(a.check_in) = CURRENT_DATE
        )::INT AS present,
        COUNT(DISTINCT a.employee_id) FILTER (
          WHERE DATE(a.check_in) = CURRENT_DATE
            AND a.check_out IS NULL
        )::INT AS checked_in,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.id NOT IN (
            SELECT DISTINCT a2.employee_id
            FROM attendances a2
            JOIN projects p2 ON p2.id = a2.project_id
            WHERE p2.company_id = $1
              AND DATE(a2.check_in) = CURRENT_DATE
          )
        )::INT AS absent,
        0::INT AS on_leave
      FROM employees e
      LEFT JOIN attendances a
        ON a.employee_id = e.id
        AND DATE(a.check_in) = CURRENT_DATE
        ${pFilter}
      WHERE e.company_id = $1
        AND e.status = 'ACTIVE'
    `,
      [companyId],
    ).catch(() => ({
      rows: [{ total: 0, present: 0, checked_in: 0, absent: 0, on_leave: 0 }],
    }));

    return row;
  }

  async getMaterials(companyId, projectId) {
    const pFilter = projectId ? `AND mr.project_id = '${projectId}'` : "";

    // FIX: same dead-`materials`-table issue as getOverview — now reads
    // project_store, consistent with the fix there.
    const {
      rows: [row],
    } = await query(
      `
      SELECT
        COUNT(*)::INT AS total_items,
        COUNT(*) FILTER (
          WHERE (ps.current_qty - ps.reserved_qty) > 0
            AND (ps.current_qty - ps.reserved_qty) < ps.min_stock_level
            AND ps.min_stock_level > 0
        )::INT AS low_stock,
        COUNT(*) FILTER (
          WHERE (ps.current_qty - ps.reserved_qty) <= 0
        )::INT AS out_of_stock
      FROM project_store ps
      JOIN projects p ON p.id = ps.project_id
      WHERE p.company_id = $1 ${pFilter.replace("mr.project_id", "ps.project_id")}
    `,
      [companyId],
    ).catch(() => ({
      rows: [{ total_items: 0, low_stock: 0, out_of_stock: 0 }],
    }));

    const {
      rows: [reqs],
    } = await query(
      `
      SELECT COUNT(*)::INT AS pending_requests
      FROM material_requests mr
      JOIN projects p ON p.id = mr.project_id
      WHERE p.company_id = $1
        AND mr.status = 'PENDING'
        ${pFilter}
    `,
      [companyId],
    ).catch(() => ({ rows: [{ pending_requests: 0 }] }));

    return { ...row, pending_requests: reqs?.pending_requests || 0 };
  }

  // Actual low/out-of-stock items (not just counts) for the dashboard's
  // alert widget — mirrors getIssues' "top N for a dashboard card" shape.
  async getLowStockItems(companyId, projectId, limit = 5) {
    const pFilter = projectId ? `AND ps.project_id = '${projectId}'` : "";

    const { rows } = await query(
      `
      SELECT
        ps.id, ps.name, ps.unit, ps.current_qty, ps.reserved_qty,
        ps.min_stock_level, (ps.current_qty - ps.reserved_qty) AS available_qty,
        p.name AS project_name, p.id AS project_id,
        CASE
          WHEN (ps.current_qty - ps.reserved_qty) <= 0 THEN 'OUT_OF_STOCK'
          ELSE 'LOW'
        END AS status
      FROM project_store ps
      JOIN projects p ON p.id = ps.project_id
      WHERE p.company_id = $1 ${pFilter}
        AND ps.min_stock_level > 0
        AND (ps.current_qty - ps.reserved_qty) < ps.min_stock_level
      ORDER BY (ps.current_qty - ps.reserved_qty) ASC
      LIMIT $2
    `,
      [companyId, limit],
    ).catch(() => ({ rows: [] }));

    return rows;
  }

  async getEquipment(companyId) {
    const {
      rows: [row],
    } = await query(
      `
      SELECT
        COUNT(*)::INT                                         AS total,
        COUNT(*) FILTER (WHERE status = 'IN_USE')::INT        AS in_use,
        COUNT(*) FILTER (WHERE status = 'IDLE')::INT          AS idle,
        COUNT(*) FILTER (WHERE status = 'MAINTENANCE')::INT   AS maintenance,
        COUNT(*) FILTER (WHERE status = 'FAULTY')::INT        AS faulty
      FROM equipment
      WHERE company_id = $1
    `,
      [companyId],
    ).catch(() => ({
      rows: [{ total: 0, in_use: 0, idle: 0, maintenance: 0, faulty: 0 }],
    }));

    return row;
  }

  async getWeeklySpend(companyId, projectId) {
    // Build params cleanly — no string interpolation of IDs into SQL
    const params = [companyId];
    let expProjectFilter = "";
    let stProjectFilter = "";

    if (projectId) {
      params.push(projectId);
      const idx = params.length; // = 2
      expProjectFilter = `AND e.project_id = $${idx}`;
      stProjectFilter = `AND st.project_id = $${idx}`;
    }

    const { rows } = await query(
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
        -- Approved expenses
        SELECT
          DATE(e.expense_date)        AS day,
          COALESCE(e.amount, 0)       AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM expenses e
        JOIN projects p ON p.id = e.project_id
        WHERE p.company_id = $1
          AND e.status = 'APPROVED'
          AND e.expense_date >= CURRENT_DATE - INTERVAL '6 days'
          ${expProjectFilter}

        UNION ALL

        -- Stock-in (materials received = real cash outflow). FIX: was
        -- stock_transactions (dead table, nothing writes to it post-store-
        -- rework) — now reads store_stock_in, which is what
        -- StoreRepository.recordStockIn actually inserts into.
        SELECT
          DATE(st.created_at)         AS day,
          0::NUMERIC                  AS expense_amount,
          COALESCE(st.total_cost, 0)  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM store_stock_in st
        JOIN projects p ON p.id = st.project_id
        WHERE p.company_id = $1
          AND st.status = 'APPROVED'
          AND DATE(st.created_at) >= CURRENT_DATE - INTERVAL '6 days'
          ${stProjectFilter}

        UNION ALL

        -- Labour logs (casual project workers)
        SELECT
          DATE(ll.log_date)           AS day,
          0::NUMERIC                  AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          COALESCE(ll.total_cost + ll.excess_amount, 0)  AS labour_amount,
          0::NUMERIC                  AS subcontract_amount
        FROM project_labour_logs ll
        JOIN projects p ON p.id = ll.project_id
        WHERE p.company_id = $1
          AND ll.status = 'APPROVED'
          AND DATE(ll.log_date) >= CURRENT_DATE - INTERVAL '6 days'
          ${expProjectFilter.replace("e.project_id", "ll.project_id")}

        UNION ALL

        -- Subcontract payments
        SELECT
          DATE(sp.payment_date)       AS day,
          0::NUMERIC                  AS expense_amount,
          0::NUMERIC                  AS stock_amount,
          0::NUMERIC                  AS labour_amount,
          COALESCE(sp.amount, 0)      AS subcontract_amount
        FROM subcontract_payments sp
        JOIN subcontracts s ON s.id = sp.subcontract_id
        JOIN projects p     ON p.id = s.project_id
        WHERE p.company_id = $1
          AND sp.status = 'APPROVED'
          AND DATE(sp.payment_date) >= CURRENT_DATE - INTERVAL '6 days'
          ${projectId ? `AND s.project_id = '${projectId}'` : ""}
      ) combined
      GROUP BY day
      ORDER BY day ASC
    `,
      params,
    );

    // Fill all 7 days using local date strings (YYYY-MM-DD in server timezone)
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Get today as a local YYYY-MM-DD string (not UTC)
    const localToday = () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const todayStr = localToday();

    // Build the 7-day window ending today using local dates
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return {
        dayStr: `${y}-${mo}-${day}`,
        dow: d.getDay(),
        label: dayNames[d.getDay()],
        isToday: `${y}-${mo}-${day}` === todayStr,
      };
    });

    return days.map(({ dayStr, dow, label }) => {
      // DB DATE columns come back as JS Date objects (midnight UTC)
      // Convert to local date string for comparison
      const existing = rows.find((r) => {
        const raw = r.day;
        let rStr;
        if (raw instanceof Date) {
          const ry = raw.getFullYear();
          const rm = String(raw.getMonth() + 1).padStart(2, "0");
          const rd = String(raw.getDate()).padStart(2, "0");
          rStr = `${ry}-${rm}-${rd}`;
        } else {
          rStr = String(raw).split("T")[0];
        }
        return rStr === dayStr;
      });
      return {
        label,
        day_of_week: dow,
        day: dayStr,
        amount: Number(existing?.amount || 0),
        expense_amount: Number(existing?.expense_amount || 0),
        stock_amount: Number(existing?.stock_amount || 0),
        labour_amount: Number(existing?.labour_amount || 0),
        subcontract_amount: Number(existing?.subcontract_amount || 0),
      };
    });
  }

  async getRecentActivity(companyId, projectId) {
    const pFilter = projectId ? `AND p.id = '${projectId}'` : "";

    const results = await Promise.allSettled([
      // FIX: was joining stock_transactions to the dead `materials` table
      // via st.material_id (a column/table pairing that no longer reflects
      // reality). Rewritten against store_stock_in + project_store, which
      // is what real stock-ins actually write to now.
      query(
        `
        SELECT 'stock' AS activity_type, 'STOCK_IN'::text AS type,
          ps.name AS entity_name, st.quantity::text AS quantity,
          ps.unit, st.total_cost, st.created_at,
          u.first_name, u.last_name, p.name AS project_name,
          NULL::text AS extra
        FROM store_stock_in st
        JOIN project_store ps ON ps.id = st.store_item_id
        JOIN users u          ON u.id  = st.recorded_by
        JOIN projects p       ON p.id  = st.project_id
        WHERE p.company_id = $1 ${pFilter}
        ORDER BY st.created_at DESC LIMIT 4
      `,
        [companyId],
      ),

      query(
        `
        SELECT 'expense' AS activity_type, e.status::text AS type,
          e.description AS entity_name, e.amount::text AS quantity,
          'NGN'::text AS unit, e.amount AS total_cost, e.created_at,
          u.first_name, u.last_name, p.name AS project_name,
          e.category::text AS extra
        FROM expenses e
        JOIN users u    ON u.id = e.submitted_by_id
        JOIN projects p ON p.id = e.project_id
        WHERE p.company_id = $1
          AND e.status = 'APPROVED'
          ${pFilter}
        ORDER BY e.created_at DESC LIMIT 4
      `,
        [companyId],
      ),

      query(
        `
        SELECT 'visitor' AS activity_type, v.status::text AS type,
          v.full_name AS entity_name, '1'::text AS quantity,
          'visitor'::text AS unit, NULL::numeric AS total_cost,
          v.time_in AS created_at,
          u.first_name, u.last_name, p.name AS project_name,
          v.purpose::text AS extra
        FROM visitors v
        JOIN users u    ON u.id = v.logged_by_id
        JOIN projects p ON p.id = v.project_id
        WHERE p.company_id = $1 ${pFilter}
        ORDER BY v.time_in DESC LIMIT 3
      `,
        [companyId],
      ),

      query(
        `
        SELECT 'attendance' AS activity_type, a.status::text AS type,
          CONCAT(e.first_name, ' ', e.last_name) AS entity_name,
          COALESCE(a.hours_worked::text, '0') AS quantity,
          'hours'::text AS unit, NULL::numeric AS total_cost,
          a.check_in AS created_at,
          e.first_name, e.last_name, p.name AS project_name,
          NULL::text AS extra
        FROM attendances a
        JOIN employees e ON e.id = a.employee_id
        JOIN projects p  ON p.id = a.project_id
        WHERE p.company_id = $1 ${pFilter}
        ORDER BY a.check_in DESC LIMIT 3
      `,
        [companyId],
      ),

      // Labour logs
      query(
        `
        SELECT 'labour' AS activity_type, 'LOG'::text AS type,
          ll.trade AS entity_name,
          ll.headcount::text AS quantity,
          'workers'::text AS unit,
          (ll.total_cost + ll.excess_amount) AS total_cost, ll.created_at,
          u.first_name, u.last_name, p.name AS project_name,
          CONCAT(ll.headcount, ' × ₦', ll.day_rate::int, '/day')::text AS extra
        FROM project_labour_logs ll
        JOIN projects p ON p.id = ll.project_id
        LEFT JOIN users u ON u.id = ll.recorded_by
        WHERE p.company_id = $1 ${pFilter.replace("p.id", "ll.project_id")}
        ORDER BY ll.created_at DESC LIMIT 4
      `,
        [companyId],
      ),

      // Subcontract payments
      query(
        `
        SELECT 'subcontract' AS activity_type, 'PAYMENT'::text AS type,
          s.company_name AS entity_name,
          sp.amount::text AS quantity,
          'NGN'::text AS unit,
          sp.amount AS total_cost,
          sp.created_at,
          u.first_name, u.last_name, p.name AS project_name,
          sp.payment_method::text AS extra
        FROM subcontract_payments sp
        JOIN subcontracts s ON s.id = sp.subcontract_id
        JOIN projects p     ON p.id = s.project_id
        LEFT JOIN users u   ON u.id = sp.recorded_by
        WHERE p.company_id = $1 ${pFilter.replace("p.id", "s.project_id")}
        ORDER BY sp.created_at DESC LIMIT 4
      `,
        [companyId],
      ),
    ]);

    return results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value.rows)
      .filter((r) => r.created_at)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 10);
  }

  async getIssues(companyId, projectId) {
    const pFilter = projectId ? `AND project_id = '${projectId}'` : "";

    const { rows } = await query(
      `
      SELECT id, title, description, severity, status, created_at
      FROM defects
      WHERE company_id = $1
        AND status NOT IN ('RESOLVED','CLOSED')
        ${pFilter}
      ORDER BY
        CASE severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 5
    `,
      [companyId],
    ).catch(() => ({ rows: [] }));

    return rows;
  }

  async getLatestDiary(companyId, projectId) {
    const pFilter = projectId ? `AND project_id = '${projectId}'` : "";

    const {
      rows: [row],
    } = await query(
      `
      SELECT id, date, weather, summary, description, notes, created_at
      FROM site_diaries
      WHERE company_id = $1 ${pFilter}
      ORDER BY date DESC, created_at DESC
      LIMIT 1
    `,
      [companyId],
    ).catch(() => ({ rows: [null] }));

    return row || null;
  }

  async getAllProjects(companyId) {
    const { rows } = await query(
      `
      SELECT
        p.id, p.name, p.type, p.status, p.location,
        p.schedule_estimated_budget,
        COALESCE(SUM(DISTINCT b.allocated), 0)::NUMERIC AS total_allocated,
        COALESCE(
          NULLIF(p.budget_override, 0),
          SUM(DISTINCT b.allocated),
          p.schedule_estimated_budget,
          0
        )::NUMERIC AS total_budget,
        COALESCE(
          SUM(ex.amount) FILTER (WHERE ex.status = 'APPROVED'), 0
        )::NUMERIC AS total_spent
      FROM projects p
      LEFT JOIN budgets b  ON b.project_id  = p.id
      LEFT JOIN expenses ex ON ex.project_id = p.id
      WHERE p.company_id = $1
        AND p.status != 'ARCHIVED'
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 10
    `,
      [companyId],
    ).catch(() => ({ rows: [] }));

    return rows;
  }
}

module.exports = DashboardRepository;
