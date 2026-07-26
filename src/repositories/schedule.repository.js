const { query, withTransaction } = require("../config/database");
const storeRepo = require("./store.repository");

class ScheduleRepository {
  // ── Progress calculation ───────────────────────────────────

  async calculateProgress(projectId) {
    // Fetch only TOP-LEVEL phases (no parent) for overall progress
    const { rows: phases } = await query(
      `
      SELECT
        ph.id, ph.name, ph.weight, ph.order_index, ph.status,
        ph.is_milestone, ph.start_date, ph.end_date, ph.due_date,
        ph.completed_at, ph.estimated_cost, ph.actual_cost,
        ph.parent_phase_id,
        -- Count tasks directly under this phase
        COUNT(DISTINCT t.id)::int                                               AS direct_tasks,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED')::int        AS direct_completed,
        -- Count ALL tasks under this phase including sub-phases (recursive)
        (
          SELECT COUNT(*)::int FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = $1
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases
                WHERE parent_phase_id = ph.id
              )
            )
        ) AS total_tasks,
        (
          SELECT COUNT(*)::int FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = $1
            AND t2.status = 'COMPLETED'
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases
                WHERE parent_phase_id = ph.id
              )
            )
        ) AS completed_tasks,
        (
          SELECT COALESCE(ROUND(AVG(t2.progress_pct)), 0)::int FROM project_tasks t2
          JOIN project_phases ph2 ON ph2.id = t2.phase_id
          WHERE ph2.project_id = $1
            AND (
              ph2.id = ph.id
              OR ph2.parent_phase_id = ph.id
              OR ph2.parent_phase_id IN (
                SELECT id FROM project_phases
                WHERE parent_phase_id = ph.id
              )
            )
        ) AS avg_progress_pct
      FROM project_phases ph
      LEFT JOIN project_tasks t ON t.phase_id = ph.id
      WHERE ph.project_id = $1
        AND ph.parent_phase_id IS NULL  -- top-level only
      GROUP BY ph.id
      ORDER BY ph.order_index ASC
    `,
      [projectId],
    );

    if (!phases.length)
      return {
        phases: [],
        overall_progress: 0,
        cost_summary: { estimated: 0, actual: 0, variance: 0 },
      };

    const enriched = phases.map((ph) => {
      let phase_progress = 0;
      if (ph.is_milestone) {
        phase_progress = ph.status === "COMPLETED" ? 100 : 0;
      } else if (ph.total_tasks === 0) {
        phase_progress = ph.status === "COMPLETED" ? 100 : 0;
      } else {
        // Use avg_progress_pct from task progress_pct values (AVG subquery)
        // Falls back to completed ratio if column doesn't exist yet
        const avgPct = ph.avg_progress_pct;
        if (avgPct !== undefined && avgPct !== null) {
          phase_progress = Math.round(Number(avgPct));
        } else if (ph.total_tasks > 0) {
          phase_progress = Math.round(
            (ph.completed_tasks / ph.total_tasks) * 100,
          );
        }
      }
      return { ...ph, phase_progress };
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

    const cost_summary = {
      estimated: enriched.reduce(
        (s, p) => s + Number(p.estimated_cost || 0),
        0,
      ),
      actual: enriched.reduce((s, p) => s + Number(p.actual_cost || 0), 0),
      variance: enriched.reduce(
        (s, p) =>
          s + Number(p.actual_cost || 0) - Number(p.estimated_cost || 0),
        0,
      ),
    };

    return { phases: enriched, overall_progress, cost_summary };
  }

  // ── Full schedule with tasks + resources ───────────────────

  async getSchedule(projectId) {
    const {
      rows: [project],
    } = await query(
      `SELECT id, name, schedule_type, schedule_estimated_budget, budget_override
       FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!project) return null;

    const { phases, overall_progress, cost_summary } =
      await this.calculateProgress(projectId);

    // Fetch ALL phases including sub-phases
    const { rows: allPhases } = await query(
      `
      SELECT
        ph.*,
        COUNT(t.id)::int                                         AS total_tasks,
        COUNT(t.id) FILTER (WHERE t.status='COMPLETED')::int     AS completed_tasks,
        COUNT(t.id) FILTER (WHERE t.status='IN_PROGRESS')::int   AS in_progress_tasks
      FROM project_phases ph
      LEFT JOIN project_tasks t ON t.phase_id = ph.id
      WHERE ph.project_id = $1
      GROUP BY ph.id
      ORDER BY ph.outline_level ASC, ph.order_index ASC
    `,
      [projectId],
    );

    const allPhaseIds = allPhases.map((p) => p.id);

    // Fetch all tasks
    let tasks = [],
      resources = [];
    if (allPhaseIds.length) {
      const { rows: t } = await query(
        `
        SELECT t.*, u.first_name, u.last_name
        FROM project_tasks t
        LEFT JOIN users u ON u.id = t.assigned_to_id
        WHERE t.phase_id = ANY($1::uuid[])
        ORDER BY t.created_at ASC
      `,
        [allPhaseIds],
      );
      tasks = t;

      const taskIds = tasks.map((t) => t.id);
      if (taskIds.length) {
        // NOTE: now also selects store_item_id/catalog_id and the linked
        // item's live availability/name, so the schedule view can show
        // "in store"/"available" for MATERIAL and catalog identity for
        // every resource type, without a separate name-match against
        // the store or catalog.
        const { rows: r } = await query(
          `
          SELECT
            r.*,
            ps.name              AS store_item_name,
            ps.current_qty       AS store_current_qty,
            ps.reserved_qty      AS store_reserved_qty,
            ps.current_qty - ps.reserved_qty AS store_available_qty,
            rc.name               AS catalog_name,
            rc.type                AS catalog_type
          FROM project_task_resources r
          LEFT JOIN project_store ps     ON ps.id = r.store_item_id
          LEFT JOIN resource_catalog rc  ON rc.id = r.catalog_id
          WHERE r.task_id = ANY($1::uuid[])
          ORDER BY r.created_at ASC
        `,
          [taskIds],
        );
        resources = r;
      }
    }

    const tasksWithResources = tasks.map((t) => ({
      ...t,
      resources: resources.filter((r) => r.task_id === t.id),
    }));

    // Build nested structure: top-level phases with sub-phases
    const phaseMap = new Map(
      allPhases.map((p) => [
        p.id,
        {
          ...p,
          phase_progress: 0,
          tasks: tasksWithResources.filter((t) => t.phase_id === p.id),
          sub_phases: [],
        },
      ]),
    );

    // Calculate phase_progress from AVG(progress_pct) across all tasks
    // including tasks in sub-phases (recursive)
    const getAvgProgress = (phaseId) => {
      const ph = phaseMap.get(phaseId);
      if (!ph) return { total: 0, sumPct: 0, completed: 0 };

      // Tasks directly under this phase
      let total = ph.tasks.length;
      let sumPct = ph.tasks.reduce(
        (s, t) => s + Number(t.progress_pct || 0),
        0,
      );
      let completed = ph.tasks.filter((t) => t.status === "COMPLETED").length;

      // Recurse into sub-phases
      for (const [, child] of phaseMap) {
        if (child.parent_phase_id === phaseId) {
          const childCounts = getAvgProgress(child.id);
          total += childCounts.total;
          sumPct += childCounts.sumPct;
          completed += childCounts.completed;
        }
      }
      return { total, sumPct, completed };
    };

    for (const [, ph] of phaseMap) {
      if (ph.is_milestone) {
        ph.phase_progress = ph.status === "COMPLETED" ? 100 : 0;
      } else {
        const { total, sumPct, completed } = getAvgProgress(ph.id);
        if (total === 0) {
          ph.phase_progress = ph.status === "COMPLETED" ? 100 : 0;
        } else {
          // Average of all task progress_pct values
          ph.phase_progress = Math.round(sumPct / total);
        }
        ph.total_tasks_all = total;
        ph.completed_tasks_all = completed;
      }
    }

    // Nest sub-phases under parents
    const topLevelPhases = [];
    for (const [, ph] of phaseMap) {
      if (ph.parent_phase_id && phaseMap.has(ph.parent_phase_id)) {
        phaseMap.get(ph.parent_phase_id).sub_phases.push(ph);
      } else {
        topLevelPhases.push(ph);
      }
    }

    return {
      schedule_type: project.schedule_type,
      overall_progress,
      cost_summary,
      estimated_budget: Number(project.schedule_estimated_budget || 0),
      total_budget: Number(
        project.budget_override || project.schedule_estimated_budget || 0,
      ),
      phases: topLevelPhases,
    };
  }

  // ── Setup / reset ──────────────────────────────────────────

  // Check if project has any phases
  async hasPhases(projectId) {
    const {
      rows: [{ count }],
    } = await query(
      `SELECT COUNT(*)::int AS count FROM project_phases WHERE project_id = $1`,
      [projectId],
    );
    return count > 0;
  }

  // Get schedule_type fresh — never cached
  async getScheduleType(projectId) {
    const {
      rows: [p],
    } = await query(`SELECT schedule_type FROM projects WHERE id=$1`, [
      projectId,
    ]);
    return p?.schedule_type || null;
  }

  async setScheduleType(projectId, scheduleType) {
    const {
      rows: [p],
    } = await query(
      `UPDATE projects SET schedule_type=$1 WHERE id=$2 RETURNING id, schedule_type`,
      [scheduleType, projectId],
    );
    return p;
  }

  async deleteSchedule(projectId) {
    await withTransaction(async (client) => {
      // Delete resources first (cascade should handle it but be explicit)
      await client.query(
        `
        DELETE FROM project_task_resources
        WHERE project_id = $1
      `,
        [projectId],
      );

      // Delete tasks
      await client.query(
        `
        DELETE FROM project_tasks
        WHERE project_id = $1
      `,
        [projectId],
      );

      // Delete phases
      await client.query(
        `
        DELETE FROM project_phases
        WHERE project_id = $1
      `,
        [projectId],
      );

      // Reset project schedule fields
      await client.query(
        `
        UPDATE projects
        SET schedule_type = NULL,
            schedule_estimated_budget = 0,
            budget_override = NULL,
            budget_approved = FALSE,
            budget_approved_by = NULL,
            budget_approved_at = NULL
        WHERE id = $1
      `,
        [projectId],
      );
    });
  }

  // ── Budget override ────────────────────────────────────────

  async setBudgetOverride(projectId, amount) {
    // Cannot set below estimated
    const {
      rows: [p],
    } = await query(
      `SELECT schedule_estimated_budget FROM projects WHERE id=$1`,
      [projectId],
    );
    if (!p) return null;

    if (Number(amount) < Number(p.schedule_estimated_budget)) {
      throw new Error(
        `Budget cannot be lower than schedule estimate of ₦${Number(p.schedule_estimated_budget).toLocaleString("en-NG")}`,
      );
    }

    const {
      rows: [updated],
    } = await query(
      `UPDATE projects SET budget_override=$1 WHERE id=$2
       RETURNING id, schedule_estimated_budget, budget_override`,
      [amount, projectId],
    );
    return updated;
  }

  // ── Phases ─────────────────────────────────────────────────

  async createPhase(projectId, companyId, data) {
    const {
      rows: [{ max_order }],
    } = await query(
      `SELECT COALESCE(MAX(order_index), 0) AS max_order
       FROM project_phases WHERE project_id=$1`,
      [projectId],
    );
    const {
      rows: [phase],
    } = await query(
      `
      INSERT INTO project_phases
        (project_id, company_id, name, description, weight, order_index,
         is_milestone, start_date, end_date, due_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
      [
        projectId,
        companyId,
        data.name,
        data.description || null,
        data.weight || 0,
        Number(max_order) + 1,
        data.isMilestone || false,
        data.startDate || null,
        data.endDate || null,
        data.dueDate || null,
      ],
    );
    return phase;
  }

  async updatePhase(phaseId, projectId, data) {
    const {
      rows: [existing],
    } = await query(
      `SELECT status FROM project_phases WHERE id=$1 AND project_id=$2`,
      [phaseId, projectId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot edit a completed phase");

    const {
      rows: [phase],
    } = await query(
      `
      UPDATE project_phases SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        weight      = COALESCE($3, weight),
        start_date  = COALESCE($4, start_date),
        end_date    = COALESCE($5, end_date),
        due_date    = COALESCE($6, due_date)
      WHERE id=$7 AND project_id=$8
      RETURNING *
    `,
      [
        data.name || null,
        data.description || null,
        data.weight || null,
        data.startDate || null,
        data.endDate || null,
        data.dueDate || null,
        phaseId,
        projectId,
      ],
    );
    return phase;
  }

  async deletePhase(phaseId, projectId) {
    const {
      rows: [existing],
    } = await query(
      `SELECT status FROM project_phases WHERE id=$1 AND project_id=$2`,
      [phaseId, projectId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot delete a completed phase");
    await query(`DELETE FROM project_phases WHERE id=$1 AND project_id=$2`, [
      phaseId,
      projectId,
    ]);
    return true;
  }

  async checkAndCompletePhase(phaseId) {
    const {
      rows: [counts],
    } = await query(
      `
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE status='COMPLETED')::int       AS completed,
        COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int     AS in_progress
      FROM project_tasks WHERE phase_id=$1
    `,
      [phaseId],
    );

    if (counts.total === 0) return false;

    if (counts.completed === counts.total) {
      // All tasks done — mark phase COMPLETED with 100% progress
      await query(
        `
        UPDATE project_phases
        SET status='COMPLETED', completed_at=NOW()
        WHERE id=$1 AND status != 'COMPLETED'
      `,
        [phaseId],
      );
      return true;
    }

    if (counts.completed > 0 || counts.in_progress > 0) {
      // Some tasks started — mark phase IN_PROGRESS
      await query(
        `
        UPDATE project_phases
        SET status='IN_PROGRESS', completed_at=NULL
        WHERE id=$1 AND status='PENDING'
      `,
        [phaseId],
      );
    }

    if (counts.completed < counts.total) {
      // Not all done — revert from COMPLETED if somehow it was marked done
      await query(
        `
        UPDATE project_phases
        SET status='IN_PROGRESS', completed_at=NULL
        WHERE id=$1 AND status='COMPLETED'
      `,
        [phaseId],
      );
    }

    return false;
  }

  // ── Tasks ──────────────────────────────────────────────────

  async createTask(phaseId, projectId, data) {
    const {
      rows: [phase],
    } = await query(
      `SELECT status, order_index FROM project_phases WHERE id=$1 AND project_id=$2`,
      [phaseId, projectId],
    );
    if (!phase) return null;
    if (phase.status === "COMPLETED")
      throw new Error("Cannot add tasks to a completed phase");

    const {
      rows: [task],
    } = await query(
      `
      INSERT INTO project_tasks
        (phase_id, project_id, name, description, start_date, end_date, assigned_to_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `,
      [
        phaseId,
        projectId,
        data.name,
        data.description || null,
        data.startDate || null,
        data.endDate || null,
        data.assignedToId || null,
      ],
    );

    await query(
      `UPDATE project_phases SET status='IN_PROGRESS' WHERE id=$1 AND status='PENDING'`,
      [phaseId],
    );
    return task;
  }

  async updateTask(taskId, phaseId, data) {
    const {
      rows: [existing],
    } = await query(
      `SELECT status FROM project_tasks WHERE id=$1 AND phase_id=$2`,
      [taskId, phaseId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot edit a completed task");

    const {
      rows: [task],
    } = await query(
      `
      UPDATE project_tasks SET
        name           = COALESCE($1, name),
        description    = COALESCE($2, description),
        start_date     = COALESCE($3, start_date),
        end_date       = COALESCE($4, end_date),
        assigned_to_id = COALESCE($5, assigned_to_id)
      WHERE id=$6 AND phase_id=$7
      RETURNING *
    `,
      [
        data.name || null,
        data.description || null,
        data.startDate || null,
        data.endDate || null,
        data.assignedToId || null,
        taskId,
        phaseId,
      ],
    );
    return task;
  }

  async updateTaskProgress(taskId, phaseId, progressPct) {
    // Clamp to 0-100
    const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
    // Auto-status: 100 = COMPLETED, 0 = PENDING, else IN_PROGRESS
    const status =
      pct === 100 ? "COMPLETED" : pct === 0 ? "PENDING" : "IN_PROGRESS";

    const {
      rows: [task],
    } = await query(
      `
      UPDATE project_tasks SET
        progress_pct = $1::integer,
        status       = $2::varchar,
        completed_at = CASE WHEN $2::varchar = 'COMPLETED' THEN NOW() ELSE NULL END
      WHERE id=$3::uuid AND phase_id=$4::uuid
      RETURNING *
    `,
      [pct, status, taskId, phaseId],
    );

    if (!task) return null;

    // phase_progress is computed in JS from task data — no DB column needed

    await this.checkAndCompletePhase(phaseId);

    // Auto-calculate wastage (issued vs planned) for this task's MATERIAL
    // resources now that it's done. Not fatal if this fails — the task
    // completion itself has already succeeded; log and move on rather
    // than roll back a real status change over a reporting side-effect.
    if (status === "COMPLETED") {
      await storeRepo
        .autoRecordWastageForTask(task.project_id, taskId)
        .catch((e) => console.error("Auto wastage calc failed:", e.message));
    }

    return task;
  }

  async updateTaskStatus(taskId, phaseId, projectId, status) {
    const {
      rows: [task],
    } = await query(
      `
      UPDATE project_tasks SET
        status       = $1::varchar,
        progress_pct = CASE
          WHEN $1::varchar = 'COMPLETED' THEN 100
          WHEN $1::varchar = 'PENDING'   THEN 0
          ELSE progress_pct
        END,
        completed_at = CASE WHEN $1::varchar = 'COMPLETED' THEN NOW() ELSE NULL END
      WHERE id=$2::uuid AND phase_id=$3::uuid
      RETURNING *
    `,
      [status, taskId, phaseId],
    );
    if (!task) return null;

    await this.checkAndCompletePhase(phaseId);

    if (status === "COMPLETED") {
      await storeRepo
        .autoRecordWastageForTask(task.project_id, taskId)
        .catch((e) => console.error("Auto wastage calc failed:", e.message));
    }

    return task;
  }

  async deleteTask(taskId, phaseId) {
    const {
      rows: [existing],
    } = await query(
      `SELECT status FROM project_tasks WHERE id=$1 AND phase_id=$2`,
      [taskId, phaseId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot delete a completed task");
    await query(`DELETE FROM project_tasks WHERE id=$1 AND phase_id=$2`, [
      taskId,
      phaseId,
    ]);
    await this.checkAndCompletePhase(phaseId);
    return true;
  }

  // ── Milestone status ───────────────────────────────────────

  async updateMilestoneStatus(phaseId, projectId, status) {
    const {
      rows: [phase],
    } = await query(
      `SELECT pp.order_index, pp.is_milestone, pp.parent_phase_id,
              (SELECT COUNT(*)::int FROM project_tasks WHERE phase_id = pp.id) AS task_count
       FROM project_phases pp
       WHERE pp.id=$1 AND pp.project_id=$2`,
      [phaseId, projectId],
    );
    if (!phase) return null;

    // Block manual completion on phases that have tasks — auto-completion handles those
    if (!phase.is_milestone && Number(phase.task_count) > 0) {
      throw new Error(
        "Phases with tasks complete automatically when all tasks are done",
      );
    }

    // Sequential check only applies to top-level phases (no parent).
    // Sub-phases sit inside a parent and can be completed independently.
    if (
      status === "COMPLETED" &&
      !phase.parent_phase_id &&
      phase.order_index > 1
    ) {
      const {
        rows: [prev],
      } = await query(
        `SELECT status FROM project_phases
         WHERE project_id=$1 AND order_index=$2 AND parent_phase_id IS NULL`,
        [projectId, phase.order_index - 1],
      );
      if (prev && prev.status !== "COMPLETED") {
        throw new Error("Complete the previous phase first");
      }
    }

    const {
      rows: [updated],
    } = await query(
      `
      UPDATE project_phases SET
        status       = $1::varchar,
        completed_at = CASE WHEN $1::varchar = 'COMPLETED' THEN NOW() ELSE NULL END
      WHERE id=$2::uuid AND project_id=$3::uuid
      RETURNING *
    `,
      [status, phaseId, projectId],
    );
    return updated;
  }

  // ── Resources ──────────────────────────────────────────────

  async getTaskResources(taskId) {
    const { rows } = await query(
      `
      SELECT
        r.*,
        ps.name              AS store_item_name,
        ps.current_qty       AS store_current_qty,
        ps.reserved_qty      AS store_reserved_qty,
        ps.current_qty - ps.reserved_qty AS store_available_qty,
        rc.name               AS catalog_name,
        rc.type                AS catalog_type
      FROM project_task_resources r
      LEFT JOIN project_store ps     ON ps.id = r.store_item_id
      LEFT JOIN resource_catalog rc  ON rc.id = r.catalog_id
      WHERE r.task_id=$1
      ORDER BY r.created_at ASC
    `,
      [taskId],
    );
    return rows;
  }

  // GENERALIZED: every resource type now resolves against resource_catalog
  // (company-wide), not just free text. MATERIAL additionally resolves
  // against project_store (this project's stock row for that catalog
  // entry), since materials are the one type with a per-project stock
  // concept — Labour/Equipment/Subcontract have none, so they only ever
  // carry catalog_id.
  //
  //   MATERIAL:
  //     data.storeItemId set    -> reuse that project_store item as-is.
  //     data.storeItemId absent -> resolve-or-create a MATERIAL catalog
  //       entry from data.description/data.unit, then resolve-or-create
  //       this project's store item for that catalog entry.
  //
  //   LABOUR / EQUIPMENT / SUBCONTRACT:
  //     data.catalogId set    -> reuse that catalog entry as-is.
  //     data.catalogId absent -> resolve-or-create a catalog entry of the
  //       matching type from data.description/data.unit.
  //
  // Everything happens in one transaction, so a task never ends up with a
  // resource pointing at a catalog/store row that failed to insert.
  async createResource(taskId, phaseId, projectId, companyId, data) {
    const {
      rows: [task],
    } = await query(`SELECT status FROM project_tasks WHERE id=$1`, [taskId]);
    if (!task) throw new Error("Task not found");
    if (task.status === "COMPLETED")
      throw new Error("Cannot add resources to a completed task");

    return withTransaction(async (client) => {
      let storeItemId = null;
      let catalogId = null;
      let description = data.description;
      let unit = data.unit;

      if (data.type === "MATERIAL") {
        if (data.storeItemId) {
          const {
            rows: [existing],
          } = await client.query(
            `SELECT id, name, unit, catalog_item_id FROM project_store WHERE id=$1 AND project_id=$2`,
            [data.storeItemId, projectId],
          );
          if (!existing) throw new Error("Selected store item not found");

          // This task may already have this exact material linked (e.g.
          // it was in the original schedule/import, or added earlier).
          // A second insert here hits the DB's uniqueness constraint on
          // (task_id, store_item_id) and comes back as a raw 409 conflict
          // with no useful context — catch it first and say what actually
          // happened instead.
          const {
            rows: [alreadyLinked],
          } = await client.query(
            `SELECT id FROM project_task_resources WHERE task_id=$1 AND store_item_id=$2`,
            [taskId, data.storeItemId],
          );
          if (alreadyLinked) {
            throw new Error(
              `"${existing.name}" is already added to this task. Edit the existing line instead of adding it again.`,
            );
          }

          storeItemId = existing.id;
          catalogId = existing.catalog_item_id;
          description = existing.name;
          unit = existing.unit;
        } else {
          if (!data.description) {
            throw new Error("description is required to create a new material");
          }

          const catalogItem = await this._resolveOrCreateCatalog(
            client,
            companyId,
            "MATERIAL",
            data.description,
            data.unit || "units",
          );
          catalogId = catalogItem.id;

          const storeItem = await this._resolveMaterialStoreItem(
            client,
            projectId,
            companyId,
            catalogItem,
            data.minStockLevel || 0,
          );
          storeItemId = storeItem.id;
          description = storeItem.name;
          unit = storeItem.unit;
        }
      } else {
        // LABOUR / EQUIPMENT / SUBCONTRACT
        if (data.catalogId) {
          const {
            rows: [existing],
          } = await client.query(
            `SELECT id, name, unit FROM resource_catalog WHERE id=$1 AND company_id=$2 AND type=$3`,
            [data.catalogId, companyId, data.type],
          );
          if (!existing) throw new Error("Selected catalog item not found");
          catalogId = existing.id;
          description = existing.name;
          // FIX: don't trust the catalog row's stored unit for LABOUR/
          // EQUIPMENT — it's not really per-entry data, it's fixed by
          // type ("workers"/"machines"). A catalog entry created before
          // that model existed (e.g. with unit="days" from an older
          // import) would otherwise silently poison every new resource
          // that reuses it. SUBCONTRACT genuinely varies per entry
          // (lump sum / m² / m³), so that one still uses the stored unit.
          unit = this._fixedUnitForType(data.type) ?? existing.unit;
        } else {
          if (!data.description) {
            throw new Error(
              `description is required to create a new ${data.type.toLowerCase()}`,
            );
          }
          const catalogItem = await this._resolveOrCreateCatalog(
            client,
            companyId,
            data.type,
            data.description,
            data.unit,
          );
          catalogId = catalogItem.id;
          description = catalogItem.name;
          unit = this._fixedUnitForType(data.type) ?? catalogItem.unit;
        }
      }

      const {
        rows: [resource],
      } = await client.query(
        `
        INSERT INTO project_task_resources
          (task_id, phase_id, project_id, company_id,
           type, description, unit, quantity, unit_cost, notes,
           store_item_id, catalog_id, duration_days, source_unit, estimated_cost)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
      `,
        [
          taskId,
          phaseId,
          projectId,
          companyId,
          data.type,
          description,
          unit,
          data.quantity,
          data.unitCost,
          data.notes || null,
          storeItemId,
          catalogId,
          data.durationDays || null,
          data.sourceUnit || null,
          // FIX: estimated_cost was never set here (only importSchedule set
          // it) — every manually-added resource has had estimated_cost sit
          // at the column default until now. Duration factors in for
          // LABOUR/EQUIPMENT (workers/machines × days × day-rate); defaults
          // to 1 for MATERIAL/SUBCONTRACT, reducing to plain quantity × cost.
          Number(data.quantity || 0) *
            Number(data.durationDays || 1) *
            Number(data.unitCost || 0),
        ],
      );

      return resource;
    });
  }

  // Shared create-or-get against resource_catalog, case-insensitive by
  // (company, type, name). Used by BOTH createResource (single add) and
  // importSchedule (bulk upload), so a name typed twice — two people
  // adding the same resource, or the same schedule imported more than
  // once — always resolves to the same catalog row instead of erroring
  // or silently duplicating.
  // LABOUR/EQUIPMENT unit is fixed by type, not a per-catalog-entry
  // attribute — "workers"/"machines" always, never something read out of
  // resource_catalog. Returns null for MATERIAL/SUBCONTRACT, where unit
  // genuinely does vary per entry ("bags"/"m³", "lump sum"/"m²"/"m³").
  _fixedUnitForType(type) {
    if (type === "LABOUR") return "workers";
    if (type === "EQUIPMENT") return "machines";
    return null;
  }

  async _resolveOrCreateCatalog(client, companyId, type, name, unit) {
    const trimmed = name.trim();
    const {
      rows: [existing],
    } = await client.query(
      `
      SELECT id, name, unit FROM resource_catalog
      WHERE company_id = $1 AND type = $2 AND LOWER(name) = LOWER($3) AND is_active = TRUE
    `,
      [companyId, type, trimmed],
    );
    if (existing) return existing;

    const {
      rows: [created],
    } = await client.query(
      `
      INSERT INTO resource_catalog (company_id, type, name, unit)
      VALUES ($1,$2,$3,$4)
      RETURNING id, name, unit
    `,
      [
        companyId,
        type,
        trimmed,
        unit ||
          (type === "MATERIAL"
            ? "units"
            : type === "LABOUR"
              ? "workers"
              : type === "EQUIPMENT"
                ? "machines"
                : "lump sum"),
      ],
    );
    return created;
  }

  // Shared create-or-get against project_store for a MATERIAL catalog
  // entry, scoped to this project. Checks catalog_item_id first (the
  // correct link going forward); falls back to a case-insensitive name
  // match for legacy store rows that predate the catalog link, and
  // backfills catalog_item_id on that row when found so it's linked
  // correctly from here on.
  async _resolveMaterialStoreItem(
    client,
    projectId,
    companyId,
    catalogItem,
    minStockLevel,
  ) {
    const {
      rows: [byCatalog],
    } = await client.query(
      `SELECT id, name, unit FROM project_store WHERE project_id=$1 AND catalog_item_id=$2`,
      [projectId, catalogItem.id],
    );
    if (byCatalog) return byCatalog;

    const {
      rows: [byName],
    } = await client.query(
      `SELECT id, name, unit FROM project_store WHERE project_id=$1 AND LOWER(name)=LOWER($2)`,
      [projectId, catalogItem.name],
    );
    if (byName) {
      await client.query(
        `UPDATE project_store SET catalog_item_id=$1 WHERE id=$2 AND catalog_item_id IS NULL`,
        [catalogItem.id, byName.id],
      );
      return byName;
    }

    const {
      rows: [created],
    } = await client.query(
      `
      INSERT INTO project_store (project_id, company_id, catalog_item_id, name, unit, min_stock_level)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, name, unit
    `,
      [
        projectId,
        companyId,
        catalogItem.id,
        catalogItem.name,
        catalogItem.unit,
        minStockLevel || 0,
      ],
    );
    return created;
  }

  async updateResource(resourceId, taskId, data) {
    const {
      rows: [existing],
    } = await query(
      `SELECT r.quantity, r.unit_cost, r.duration_days, t.status
       FROM project_task_resources r
       JOIN project_tasks t ON t.id = r.task_id
       WHERE r.id=$1 AND r.task_id=$2`,
      [resourceId, taskId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot edit resources on a completed task");

    // FIX: this never recomputed estimated_cost either — editing quantity
    // or unit_cost silently left the old (or never-set, see createResource)
    // estimated_cost in place. Merge the incoming partial update with the
    // resource's current values so the recompute is correct whether the
    // caller sent all three fields or just one.
    const mergedQuantity =
      data.quantity !== undefined && data.quantity !== null
        ? data.quantity
        : existing.quantity;
    const mergedUnitCost =
      data.unitCost !== undefined && data.unitCost !== null
        ? data.unitCost
        : existing.unit_cost;
    const mergedDuration =
      data.durationDays !== undefined
        ? data.durationDays
        : existing.duration_days;
    const estimatedCost =
      Number(mergedQuantity || 0) *
      Number(mergedDuration || 1) *
      Number(mergedUnitCost || 0);

    const {
      rows: [resource],
    } = await query(
      `
      UPDATE project_task_resources SET
        description   = COALESCE($1, description),
        unit          = COALESCE($2, unit),
        quantity      = COALESCE($3, quantity),
        unit_cost     = COALESCE($4, unit_cost),
        notes         = COALESCE($5, notes),
        is_procured   = COALESCE($6, is_procured),
        duration_days = $7,
        estimated_cost = $8,
        procured_at   = CASE WHEN $6 = TRUE AND is_procured = FALSE THEN NOW()
                          WHEN $6 = FALSE THEN NULL
                          ELSE procured_at END
      WHERE id=$9 AND task_id=$10
      RETURNING *
    `,
      [
        data.description || null,
        data.unit || null,
        data.quantity || null,
        data.unitCost || null,
        data.notes || null,
        data.isProcured ?? null,
        mergedDuration || null,
        estimatedCost,
        resourceId,
        taskId,
      ],
    );
    return resource;
  }

  async deleteResource(resourceId, taskId) {
    const {
      rows: [existing],
    } = await query(
      `SELECT t.status FROM project_task_resources r
       JOIN project_tasks t ON t.id = r.task_id
       WHERE r.id=$1 AND r.task_id=$2`,
      [resourceId, taskId],
    );
    if (!existing) return null;
    if (existing.status === "COMPLETED")
      throw new Error("Cannot delete resources on a completed task");
    await query(`DELETE FROM project_task_resources WHERE id=$1`, [resourceId]);
    return true;
  }

  async markResourceProcured(resourceId, taskId, isProcured) {
    const {
      rows: [resource],
    } = await query(
      `
      UPDATE project_task_resources SET
        is_procured = $1,
        procured_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END
      WHERE id=$2 AND task_id=$3
      RETURNING *
    `,
      [isProcured, resourceId, taskId],
    );
    return resource;
  }

  // NOTE: linkResourceToMaterial and requestFromStore removed. Both queried
  // the old `materials` table, which is no longer live — material tracking
  // now goes through project_store exclusively, and linking now happens at
  // creation time via createResource's storeItemId, or after the fact via
  // store.repository.js's linkStoreItemToResource.

  // ── Procurement schedule ───────────────────────────────────

  async getProcurementSchedule(projectId, filters = {}) {
    const params = [projectId];
    const conditions = ["r.project_id = $1"];

    if (filters.type) {
      params.push(filters.type);
      conditions.push(`r.type = $${params.length}`);
    }
    if (filters.isProcured !== undefined) {
      params.push(filters.isProcured);
      conditions.push(`r.is_procured = $${params.length}`);
    }
    if (filters.phaseId) {
      params.push(filters.phaseId);
      conditions.push(`r.phase_id = $${params.length}`);
    }

    const { rows } = await query(
      `
      SELECT
        r.*,
        t.name       AS task_name,
        t.start_date AS needed_by,
        t.status     AS task_status,
        ph.name      AS phase_name,
        ph.order_index
      FROM project_task_resources r
      JOIN project_tasks  t  ON t.id  = r.task_id
      JOIN project_phases ph ON ph.id = r.phase_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.start_date ASC NULLS LAST, r.type, r.description
    `,
      params,
    );
    return rows;
  }

  // ── Cost variance report ───────────────────────────────────

  async getCostVariance(projectId) {
    const { rows } = await query(
      `
      SELECT
        ph.id          AS phase_id,
        ph.name        AS phase_name,
        ph.order_index,
        ph.status      AS phase_status,
        ph.estimated_cost AS phase_estimated,
        ph.actual_cost    AS phase_actual,
        ph.actual_cost - ph.estimated_cost AS phase_variance,
        json_agg(
          json_build_object(
            'task_id',        t.id,
            'task_name',      t.name,
            'task_status',    t.status,
            'estimated_cost', t.estimated_cost,
            'actual_cost',    t.actual_cost,
            'variance',       t.actual_cost - t.estimated_cost,
            'resources',      (
              SELECT json_agg(json_build_object(
                'id',             r.id,
                'type',           r.type,
                'description',    r.description,
                'estimated_cost', r.estimated_cost,
                'actual_cost',    r.actual_cost,
                'variance',       r.actual_cost - r.estimated_cost,
                'is_procured',    r.is_procured
              ))
              FROM project_task_resources r
              WHERE r.task_id = t.id
            )
          )
          ORDER BY t.created_at
        ) AS tasks
      FROM project_phases ph
      LEFT JOIN project_tasks t ON t.phase_id = ph.id
      WHERE ph.project_id = $1
      GROUP BY ph.id, ph.name, ph.order_index, ph.status, ph.estimated_cost, ph.actual_cost
      ORDER BY ph.order_index
    `,
      [projectId],
    );
    return rows;
  }

  // ── Excel upload ───────────────────────────────────────────

  async importSchedule(projectId, companyId, phases) {
    await withTransaction(async (client) => {
      // Clear existing schedule data
      await client.query(
        `DELETE FROM project_task_resources WHERE project_id=$1`,
        [projectId],
      );
      await client.query(
        `DELETE FROM project_tasks        WHERE project_id=$1`,
        [projectId],
      );
      await client.query(
        `DELETE FROM project_phases       WHERE project_id=$1`,
        [projectId],
      );

      // Two-pass import:
      // Pass 1: insert all phases, build name → id map
      // Pass 2: set parent_phase_id using the map

      const phaseIdMap = new Map(); // phase name → db id
      let orderIndex = 1;

      // Separate top-level and sub-phases
      const topPhases = phases.filter(
        (p) => !p.parentName || p.outlineLevel === 1,
      );
      const subPhases = phases.filter(
        (p) => p.parentName && p.outlineLevel > 1,
      );

      // Insert top-level phases first
      for (const ph of topPhases) {
        const {
          rows: [phase],
        } = await client.query(
          `
          INSERT INTO project_phases
            (project_id, company_id, name, weight, order_index,
             start_date, end_date, is_milestone, duration_days,
             outline_level, source_id, is_summary)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING id
        `,
          [
            projectId,
            companyId,
            ph.name,
            ph.weight || 0,
            orderIndex++,
            ph.startDate || null,
            ph.endDate || null,
            ph.isMilestone || false,
            ph.durationDays || null,
            ph.outlineLevel || 1,
            ph.sourceId || null,
            ph.tasks?.length === 0 || false, // summary if no direct tasks
          ],
        );
        phaseIdMap.set(ph.name, phase.id);
      }

      // Insert sub-phases
      let subOrderIndex = 1;
      for (const ph of subPhases) {
        const parentId = phaseIdMap.get(ph.parentName) || null;
        const {
          rows: [phase],
        } = await client.query(
          `
          INSERT INTO project_phases
            (project_id, company_id, name, weight, order_index,
             parent_phase_id, start_date, end_date, is_milestone,
             duration_days, outline_level, source_id, is_summary)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING id
        `,
          [
            projectId,
            companyId,
            ph.name,
            0, // sub-phases don't have independent weights
            subOrderIndex++,
            parentId,
            ph.startDate || null,
            ph.endDate || null,
            ph.isMilestone || false,
            ph.durationDays || null,
            ph.outlineLevel || 2,
            ph.sourceId || null,
            ph.tasks?.length === 0 || false,
          ],
        );
        phaseIdMap.set(ph.name, phase.id);
      }

      // Insert tasks and resources for ALL phases
      for (const ph of phases) {
        const phaseDbId = phaseIdMap.get(ph.name);
        if (!phaseDbId) continue;

        for (const task of ph.tasks || []) {
          const {
            rows: [t],
          } = await client.query(
            `
            INSERT INTO project_tasks
              (phase_id, project_id, name, start_date, end_date,
               duration_days, is_milestone, predecessors, source_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id
          `,
            [
              phaseDbId,
              projectId,
              task.name,
              task.startDate || null,
              task.endDate || null,
              task.durationDays || null,
              task.isMilestone || false,
              task.predecessors || null,
              task.sourceId || null,
            ],
          );

          for (const res of task.resources || []) {
            // Resolve/create the catalog entry (and, for MATERIAL, the
            // project's store item) BEFORE inserting the resource row that
            // references them — same order and same create-or-get helpers
            // createResource uses for a single manual add. Both helpers do
            // a case-insensitive name lookup before inserting, so importing
            // the same schedule twice re-links to the same catalog/store
            // rows instead of duplicating them.
            let storeItemId = null;
            let catalogId = null;
            let description = res.description;
            let unit =
              res.unit || (res.type === "MATERIAL" ? "units" : "lump sum");

            if (res.type && res.description) {
              const catalogItem = await this._resolveOrCreateCatalog(
                client,
                companyId,
                res.type,
                res.description,
                unit,
              );
              catalogId = catalogItem.id;
              description = catalogItem.name;
              // FIX: this is what actually caused "3 days for 1 day"
              // instead of "3 workers for 1 day" — reusing an existing
              // catalog entry (matched by name) pulled its stored unit
              // ("days", from before this model existed) instead of the
              // correctly-computed "workers"/"machines". Unit for these
              // two types is fixed by type, never read from the catalog.
              unit = this._fixedUnitForType(res.type) ?? catalogItem.unit;

              if (res.type === "MATERIAL") {
                const storeItem = await this._resolveMaterialStoreItem(
                  client,
                  projectId,
                  companyId,
                  catalogItem,
                  0,
                );
                storeItemId = storeItem.id;
              }
            }

            await client.query(
              `
              INSERT INTO project_task_resources
                (task_id, phase_id, project_id, company_id,
                 type, description, unit, quantity, unit_cost,
                 estimated_cost, source, source_id, store_item_id, catalog_id,
                 duration_days, source_unit)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            `,
              [
                t.id,
                phaseDbId,
                projectId,
                companyId,
                res.type,
                description,
                unit,
                res.quantity || null,
                res.unitCost || null,
                res.estimatedCost || 0,
                res.source || "MANUAL",
                res.sourceId || null,
                storeItemId,
                catalogId,
                res.durationDays || null,
                res.sourceUnit || null,
              ],
            );
          }
        }
      }

      await client.query(
        `UPDATE projects SET schedule_type='UPLOAD' WHERE id=$1`,
        [projectId],
      );
    });
  }
}

module.exports = ScheduleRepository;
