// backend/src/repositories/equipment.repository.js
const { query, withTransaction } = require("../config/database");
const BaseRepository = require("./base.repository");

class EquipmentRepository extends BaseRepository {
  constructor() {
    super("equipment");
  }

  // ── List ──────────────────────────────────────────────────────────────
  async findByCompany(
    companyId,
    { status, type, ownership_type, search } = {},
  ) {
    const conds = ["e.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (status) {
      conds.push(`e.status = $${i++}`);
      params.push(status);
    }
    if (type) {
      conds.push(`e.type = $${i++}`);
      params.push(type);
    }
    if (ownership_type) {
      conds.push(`e.ownership_type = $${i++}`);
      params.push(ownership_type);
    }
    if (search) {
      conds.push(`e.name ILIKE $${i++}`);
      params.push(`%${search}%`);
    }

    const { rows } = await query(
      `
      SELECT
        e.*,
        p.name AS hire_project_name,
        r.description  AS resource_description,
        r.estimated_cost AS resource_estimated_cost,
        r.actual_cost    AS resource_actual_cost,
        t.name         AS resource_task_name,
        ph.name        AS resource_phase_name,
        (SELECT row_to_json(eu)
         FROM equipment_usages eu
         WHERE eu.equipment_id = e.id AND eu.end_time IS NULL
         LIMIT 1) AS active_usage
      FROM equipment e
      LEFT JOIN projects p              ON p.id  = e.hire_project_id
      LEFT JOIN project_task_resources r ON r.id  = e.task_resource_id
      LEFT JOIN project_tasks t          ON t.id  = r.task_id
      LEFT JOIN project_phases ph        ON ph.id = t.phase_id
      WHERE ${conds.join(" AND ")}
      ORDER BY e.ownership_type ASC, e.name ASC
    `,
      params,
    );
    return rows;
  }

  // ── Schedule equipment resources (unlinked) ────────────────────────────
  async getScheduleResources(projectId, companyId) {
    const { rows } = await query(
      `
      SELECT
        r.id, r.description, r.quantity, r.unit, r.unit_cost,
        r.estimated_cost, r.actual_cost, r.task_id,
        t.name AS task_name,
        ph.name AS phase_name,
        -- check if already linked to an equipment record
        (SELECT e.id FROM equipment e WHERE e.task_resource_id = r.id LIMIT 1) AS linked_equipment_id,
        (SELECT e.name FROM equipment e WHERE e.task_resource_id = r.id LIMIT 1) AS linked_equipment_name,
        (SELECT e.status FROM equipment e WHERE e.task_resource_id = r.id LIMIT 1) AS linked_equipment_status
      FROM project_task_resources r
      JOIN project_tasks t    ON t.id  = r.task_id
      JOIN project_phases ph  ON ph.id = t.phase_id
      JOIN projects p         ON p.id  = ph.project_id
      WHERE r.type = 'EQUIPMENT'
        AND ph.project_id = $1
        AND p.company_id  = $2
      ORDER BY ph.order_index ASC, t.start_date ASC, r.description ASC
    `,
      [projectId, companyId],
    );
    return rows;
  }

  // ── Create ─────────────────────────────────────────────────────────────
  async create(data) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `
        INSERT INTO equipment
          (company_id, name, type, serial_no, rate_per_hour, notes,
           ownership_type, hire_company, hire_start_date, hire_end_date,
           hire_rate, hire_rate_unit, hire_project_id, task_resource_id, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
      `,
        [
          data.companyId,
          data.name,
          data.type || "Equipment",
          data.serialNo || null,
          data.ratePerHour || 0,
          data.notes || null,
          data.ownershipType || "OWNED",
          data.hireCompany || null,
          data.hireStartDate || null,
          data.hireEndDate || null,
          data.hireRate || null,
          data.hireRateUnit || null,
          data.hireProjectId || null,
          data.taskResourceId || null,
          data.ownershipType === "HIRED" ? "ACTIVE" : "AVAILABLE",
        ],
      );

      // If linked to a schedule resource, log hire start event
      if (data.ownershipType === "HIRED") {
        await this._logClient(client, {
          equipmentId: rows[0].id,
          companyId: data.companyId,
          projectId: data.hireProjectId || null,
          eventType: "HIRE_START",
          actorId: data.actorId || null,
          cost: null,
          notes: `Hired from ${data.hireCompany || "unknown"}`,
          metadata: {
            hire_company: data.hireCompany,
            hire_rate: data.hireRate,
            hire_rate_unit: data.hireRateUnit,
            hire_start: data.hireStartDate,
            hire_end: data.hireEndDate,
            task_resource_id: data.taskResourceId || null,
          },
        });
      }

      return rows[0];
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────
  async update(id, data) {
    const allowed = [
      "name",
      "type",
      "serial_no",
      "rate_per_hour",
      "status",
      "notes",
      "hire_company",
      "hire_start_date",
      "hire_end_date",
      "hire_rate",
      "hire_rate_unit",
      "hire_project_id",
      "next_maintenance_at",
      "task_resource_id",
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

  // ── Usage (owned) ──────────────────────────────────────────────────────
  async startUsage(equipmentId, { projectId, operatorId, notes, companyId }) {
    return withTransaction(async (client) => {
      await client.query(
        "UPDATE equipment SET status='IN_USE', updated_at=NOW() WHERE id=$1",
        [equipmentId],
      );
      const { rows } = await client.query(
        `
        INSERT INTO equipment_usages
          (equipment_id, project_id, operator_id, notes)
        VALUES ($1,$2,$3,$4) RETURNING *
      `,
        [equipmentId, projectId || null, operatorId, notes || null],
      );

      await this._logClient(client, {
        equipmentId,
        companyId,
        projectId: projectId || null,
        eventType: "USAGE_START",
        actorId: operatorId,
        notes: notes || null,
        metadata: { start_time: new Date().toISOString() },
      });
      return rows[0];
    });
  }

  async endUsage(usageId, equipmentId, { companyId } = {}) {
    return withTransaction(async (client) => {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Get equipment row directly
      const {
        rows: [eq],
      } = await client.query("SELECT * FROM equipment WHERE id=$1", [
        equipmentId,
      ]);
      if (!eq) throw new Error(`Equipment ${equipmentId} not found`);

      // Find all open usage rows for this equipment
      const { rows: openUsages } = await client.query(
        `
        SELECT * FROM equipment_usages
        WHERE equipment_id=$1 AND end_time IS NULL
        ORDER BY start_time DESC
      `,
        [equipmentId],
      );

      let usage = null;
      if (usageId && UUID_RE.test(usageId)) {
        usage = openUsages.find((r) => r.id === usageId) || null;
      }
      if (!usage && openUsages.length > 0) usage = openUsages[0];

      // No open usage — reset equipment and return
      if (!usage) {
        await client.query(
          "UPDATE equipment SET status='AVAILABLE', updated_at=NOW() WHERE id=$1",
          [equipmentId],
        );
        return {
          already_ended: true,
          duration_hrs: 0,
          total_cost: 0,
          formatted_duration: "0h 0m",
        };
      }

      // Close ALL open usages
      const endTime = new Date();
      for (const ou of openUsages) {
        const dh = Math.max((endTime - new Date(ou.start_time)) / 3600000, 0);
        const tc = Math.round(dh * parseFloat(eq.rate_per_hour || 0));
        await client.query(
          `
          UPDATE equipment_usages
          SET end_time=$1, duration_hrs=$2, total_cost=$3
          WHERE id=$4
        `,
          [endTime, Math.round(dh * 100) / 100, tc, ou.id],
        );
      }

      // Primary usage result
      const durationHrs = Math.max(
        (endTime - new Date(usage.start_time)) / 3600000,
        0,
      );
      const totalCost = Math.round(
        durationHrs * parseFloat(eq.rate_per_hour || 0),
      );
      const totalHrsAll = openUsages.reduce(
        (s, r) => s + Math.max((endTime - new Date(r.start_time)) / 3600000, 0),
        0,
      );

      // Update equipment status and hours
      await client.query(
        `
        UPDATE equipment
        SET status='AVAILABLE',
            total_hours_logged = total_hours_logged + $1,
            updated_at = NOW()
        WHERE id=$2
      `,
        [Math.round(totalHrsAll * 100) / 100, equipmentId],
      );

      // Auto-create expense for usage cost (owned equipment)
      let expenseId = null;
      const projectId = usage.project_id || eq.hire_project_id;
      if (totalCost > 0 && projectId) {
        const {
          rows: [exp],
        } = await client.query(
          `
          INSERT INTO expenses
            (project_id, submitted_by_id, category, description,
             amount, expense_date, status)
          VALUES ($1,$2,'Equipment Usage',$3,$4,CURRENT_DATE,'APPROVED')
          RETURNING id
        `,
          [
            projectId,
            usage.operator_id,
            `Equipment usage: ${eq.name} (${Math.round(durationHrs * 10) / 10}h @ ${fmtRate(eq.rate_per_hour)}/hr)`,
            totalCost,
          ],
        );
        expenseId = exp.id;
      }

      // Update schedule resource actual_cost if linked
      if (eq.task_resource_id && totalCost > 0) {
        await client.query(
          `
          UPDATE project_task_resources
          SET actual_cost = actual_cost + $1
          WHERE id = $2
        `,
          [totalCost, eq.task_resource_id],
        );
      }

      await this._logClient(client, {
        equipmentId,
        companyId: companyId || eq.company_id,
        projectId,
        eventType: "USAGE_END",
        actorId: usage.operator_id,
        cost: totalCost,
        notes:
          openUsages.length > 1 ? `${openUsages.length} sessions closed` : null,
        metadata: {
          duration_hrs: Math.round(durationHrs * 100) / 100,
          total_cost: totalCost,
          rate_per_hour: eq.rate_per_hour,
          sessions_closed: openUsages.length,
          expense_id: expenseId,
        },
      });

      const {
        rows: [updated],
      } = await client.query("SELECT * FROM equipment_usages WHERE id=$1", [
        usage.id,
      ]);
      return {
        ...(updated || {}),
        formatted_duration: `${Math.floor(durationHrs)}h ${Math.round((durationHrs % 1) * 60)}m`,
        expense_id: expenseId,
      };
    });
  }

  // ── Hire return ────────────────────────────────────────────────────────
  async returnHire(equipmentId, { actorId, notes, companyId, projectId }) {
    return withTransaction(async (client) => {
      const {
        rows: [eq],
      } = await client.query("SELECT * FROM equipment WHERE id=$1", [
        equipmentId,
      ]);
      if (!eq) throw new Error("Equipment not found");

      // Calculate hire cost
      let hireCost = 0;
      if (eq.hire_start_date && eq.hire_rate && eq.hire_rate_unit) {
        const days = Math.ceil(
          (Date.now() - new Date(eq.hire_start_date)) / 86400000,
        );
        const rate = parseFloat(eq.hire_rate);
        hireCost =
          eq.hire_rate_unit === "DAY"
            ? rate * days
            : eq.hire_rate_unit === "WEEK"
              ? rate * Math.ceil(days / 7)
              : /* MONTH */ rate * Math.ceil(days / 30);
        hireCost = Math.round(hireCost);
      }

      await client.query(
        "UPDATE equipment SET status='RETURNED', updated_at=NOW() WHERE id=$1",
        [equipmentId],
      );

      // Auto-create expense against project
      let expenseId = null;
      const resolvedProjectId = projectId || eq.hire_project_id;
      if (hireCost > 0 && resolvedProjectId) {
        const {
          rows: [exp],
        } = await client.query(
          `
          INSERT INTO expenses
            (project_id, submitted_by_id, category, description,
             amount, expense_date, status)
          VALUES ($1,$2,'Equipment Hire',$3,$4,CURRENT_DATE,'APPROVED')
          RETURNING id
        `,
          [
            resolvedProjectId,
            actorId,
            `Equipment hire: ${eq.name} (${eq.hire_company || "external"})`,
            hireCost,
          ],
        );
        expenseId = exp.id;
      }

      // Update schedule resource actual_cost if linked
      if (eq.task_resource_id && hireCost > 0) {
        await client.query(
          `
          UPDATE project_task_resources
          SET actual_cost = $1
          WHERE id = $2
        `,
          [hireCost, eq.task_resource_id],
        );
      }

      await this._logClient(client, {
        equipmentId,
        companyId,
        projectId: resolvedProjectId,
        eventType: "HIRE_END",
        actorId,
        cost: hireCost,
        notes: notes || null,
        metadata: {
          hire_company: eq.hire_company,
          hire_start_date: eq.hire_start_date,
          return_date: new Date().toISOString().split("T")[0],
          hire_cost: hireCost,
          hire_rate: eq.hire_rate,
          hire_rate_unit: eq.hire_rate_unit,
          expense_id: expenseId,
          task_resource_id: eq.task_resource_id,
        },
      });

      return { equipmentId, hireCost, expenseId };
    });
  }

  // ── Maintenance ────────────────────────────────────────────────────────
  async logMaintenance(
    equipmentId,
    {
      description,
      cost,
      technicianName,
      nextDueAt,
      completedNow,
      actorId,
      companyId,
    },
  ) {
    return withTransaction(async (client) => {
      const {
        rows: [eq],
      } = await client.query("SELECT * FROM equipment WHERE id=$1", [
        equipmentId,
      ]);

      const {
        rows: [log],
      } = await client.query(
        `
        INSERT INTO maintenance_logs
          (equipment_id, type, description, cost, next_due_at, technician_name)
        VALUES ($1,'ROUTINE',$2,$3,$4,$5) RETURNING *
      `,
        [
          equipmentId,
          description,
          cost || null,
          nextDueAt || null,
          technicianName || null,
        ],
      );

      const newStatus = completedNow
        ? eq.ownership_type === "HIRED"
          ? "ACTIVE"
          : "AVAILABLE"
        : "MAINTENANCE";

      await client.query(
        `
        UPDATE equipment
        SET status=$1, next_maintenance_at=$2, updated_at=NOW()
        WHERE id=$3
      `,
        [newStatus, nextDueAt || null, equipmentId],
      );

      // Auto-create expense
      let expenseId = null;
      const maintenanceCost = Number(cost || 0);
      if (maintenanceCost > 0) {
        const {
          rows: [exp],
        } = await client.query(
          `
          INSERT INTO expenses
            (project_id, submitted_by_id, category, description,
             amount, expense_date, status)
          VALUES ($1,$2,'Equipment Maintenance',$3,$4,CURRENT_DATE,'APPROVED')
          RETURNING id
        `,
          [
            eq.hire_project_id || null,
            actorId,
            `Maintenance: ${eq.name}${technicianName ? " — " + technicianName : ""}`,
            maintenanceCost,
          ],
        );
        expenseId = exp.id;
      }

      await this._logClient(client, {
        equipmentId,
        companyId,
        projectId: eq.hire_project_id || null,
        eventType: "MAINTENANCE",
        actorId,
        cost: maintenanceCost || null,
        notes: description,
        metadata: {
          technician_name: technicianName,
          next_due_at: nextDueAt,
          completed_now: completedNow,
          expense_id: expenseId,
        },
      });

      return { ...log, expenseId };
    });
  }

  // ── Activity history ───────────────────────────────────────────────────
  async getActivity(equipmentId, companyId, { limit = 50 } = {}) {
    const { rows } = await query(
      `
      SELECT al.*,
        u.first_name, u.last_name,
        p.name AS project_name
      FROM equipment_activity_log al
      LEFT JOIN users u    ON u.id = al.actor_id
      LEFT JOIN projects p ON p.id = al.project_id
      WHERE al.equipment_id=$1 AND al.company_id=$2
      ORDER BY al.created_at DESC
      LIMIT $3
    `,
      [equipmentId, companyId, limit],
    );
    return rows;
  }

  async getCompanyActivity(companyId, { limit = 100, equipmentId } = {}) {
    const conds = ["al.company_id = $1"];
    const params = [companyId];
    if (equipmentId) {
      conds.push("al.equipment_id = $2");
      params.push(equipmentId);
    }
    params.push(limit);
    const { rows } = await query(
      `
      SELECT al.*,
        e.name AS equipment_name, e.ownership_type,
        u.first_name, u.last_name,
        p.name AS project_name
      FROM equipment_activity_log al
      JOIN equipment e ON e.id = al.equipment_id
      LEFT JOIN users u    ON u.id = al.actor_id
      LEFT JOIN projects p ON p.id = al.project_id
      WHERE ${conds.join(" AND ")}
      ORDER BY al.created_at DESC
      LIMIT $${params.length}
    `,
      params,
    );
    return rows;
  }

  // ── Re-hire (update existing record in place) ────────────────────────
  async reHire(
    equipmentId,
    {
      hireCompany,
      hireRate,
      hireRateUnit,
      hireStartDate,
      hireEndDate,
      actorId,
      companyId,
      projectId,
    },
  ) {
    return withTransaction(async (client) => {
      const {
        rows: [eq],
      } = await client.query("SELECT * FROM equipment WHERE id=$1", [
        equipmentId,
      ]);
      if (!eq) throw new Error("Equipment not found");
      if (eq.status !== "RETURNED")
        throw new Error("Only returned equipment can be re-hired");

      const {
        rows: [updated],
      } = await client.query(
        `
        UPDATE equipment SET
          status          = 'ACTIVE',
          hire_company    = $1,
          hire_rate       = $2,
          hire_rate_unit  = $3,
          hire_start_date = $4,
          hire_end_date   = $5,
          hire_project_id = COALESCE($6, hire_project_id),
          updated_at      = NOW()
        WHERE id = $7
        RETURNING *
      `,
        [
          hireCompany || eq.hire_company,
          hireRate || eq.hire_rate,
          hireRateUnit || eq.hire_rate_unit,
          hireStartDate,
          hireEndDate || null,
          projectId || null,
          equipmentId,
        ],
      );

      await this._logClient(client, {
        equipmentId,
        companyId,
        projectId: projectId || eq.hire_project_id,
        eventType: "HIRE_START",
        actorId,
        cost: null,
        notes: `Re-hired from ${hireCompany || eq.hire_company || "unknown"}`,
        metadata: {
          hire_company: hireCompany || eq.hire_company,
          hire_rate: hireRate || eq.hire_rate,
          hire_rate_unit: hireRateUnit || eq.hire_rate_unit,
          hire_start: hireStartDate,
          hire_end: hireEndDate || null,
          rehire: true,
        },
      });

      return updated;
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────
  async _log(data) {
    await query(
      `
      INSERT INTO equipment_activity_log
        (equipment_id, company_id, project_id, event_type, actor_id, cost, notes, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [
        data.equipmentId,
        data.companyId,
        data.projectId || null,
        data.eventType,
        data.actorId || null,
        data.cost || null,
        data.notes || null,
        JSON.stringify(data.metadata || {}),
      ],
    ).catch((err) => console.warn("Activity log failed:", err.message));
  }

  async _logClient(client, data) {
    await client
      .query(
        `
      INSERT INTO equipment_activity_log
        (equipment_id, company_id, project_id, event_type, actor_id, cost, notes, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
        [
          data.equipmentId,
          data.companyId,
          data.projectId || null,
          data.eventType,
          data.actorId || null,
          data.cost || null,
          data.notes || null,
          JSON.stringify(data.metadata || {}),
        ],
      )
      .catch((err) => console.warn("Activity log failed:", err.message));
  }
}

function fmtRate(n) {
  const v = Number(n || 0);
  if (v >= 1000000) return `₦${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `₦${(v / 1000).toFixed(0)}k`;
  return `₦${v}`;
}

module.exports = EquipmentRepository;
