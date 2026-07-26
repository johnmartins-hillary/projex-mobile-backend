// backend/src/repositories/store.repository.js
"use strict";

const { query, withTransaction } = require("../config/database");

class StoreRepository {
  // ── Resource Catalog ──────────────────────────────────────────────────────────
  // Company-wide, cross-project catalog covering all 4 resource types
  // (was material_catalog / MATERIAL-only; renamed + generalized since
  // nothing was consuming it yet). project_store rows link back here via
  // catalog_item_id for MATERIAL; project_task_resources links here
  // directly via catalog_id for LABOUR/EQUIPMENT/SUBCONTRACT, which have
  // no per-project stock concept of their own.

  async getCatalog(companyId, filters = {}) {
    const conds = ["company_id = $1", "is_active = TRUE"];
    const params = [companyId];
    if (filters.type) {
      params.push(filters.type);
      conds.push(`type = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conds.push(`name ILIKE $${params.length}`);
    }
    const { rows } = await query(
      `
      SELECT * FROM resource_catalog
      WHERE ${conds.join(" AND ")}
      ORDER BY type, category, name
    `,
      params,
    );
    return rows;
  }

  async createCatalogItem(companyId, data) {
    const {
      rows: [item],
    } = await query(
      `
      INSERT INTO resource_catalog (company_id, type, name, unit, category, min_stock_level)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
      [
        companyId,
        data.type,
        data.name,
        data.unit || (data.type === "MATERIAL" ? "units" : "lump sum"),
        data.category || null,
        data.minStockLevel || 0,
      ],
    );
    return item;
  }

  async updateCatalogItem(id, companyId, data) {
    const {
      rows: [item],
    } = await query(
      `
      UPDATE resource_catalog SET
        name            = COALESCE($1, name),
        unit            = COALESCE($2, unit),
        category        = COALESCE($3, category),
        min_stock_level = COALESCE($4, min_stock_level),
        updated_at      = NOW()
      WHERE id = $5 AND company_id = $6
      RETURNING *
    `,
      [data.name, data.unit, data.category, data.minStockLevel, id, companyId],
    );
    return item;
  }

  async deleteCatalogItem(id, companyId) {
    await query(
      `UPDATE resource_catalog SET is_active=FALSE WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
  }

  // ── Project Store ─────────────────────────────────────────────────────────────

  async getStore(projectId) {
    const { rows } = await query(
      `
      SELECT
        ps.*,
        ps.current_qty - ps.reserved_qty          AS available_qty,
        (ps.current_qty - ps.reserved_qty) < ps.min_stock_level AS low_stock,
        COALESCE(
          (SELECT SUM(si.total_cost) FROM store_stock_in si WHERE si.store_item_id = ps.id), 0
        ) AS total_invested,
        (SELECT COUNT(*) FROM material_requests mr
         WHERE mr.store_item_id = ps.id AND mr.status = 'PENDING')::int AS pending_requests
      FROM project_store ps
      WHERE ps.project_id = $1
      ORDER BY ps.name
    `,
      [projectId],
    );
    return rows;
  }

  async getStoreItem(id, projectId) {
    const {
      rows: [item],
    } = await query(
      `
      SELECT ps.*,
        ps.current_qty - ps.reserved_qty AS available_qty,
        (ps.current_qty - ps.reserved_qty) < ps.min_stock_level AS low_stock
      FROM project_store ps
      WHERE ps.id = $1 AND ps.project_id = $2
    `,
      [id, projectId],
    );
    return item;
  }

  async createStoreItem(projectId, companyId, data) {
    return withTransaction(async (client) => {
      const {
        rows: [item],
      } = await client.query(
        `
        INSERT INTO project_store
          (project_id, company_id, catalog_item_id, name, unit, min_stock_level)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
        [
          projectId,
          companyId,
          data.catalogItemId || null,
          data.name,
          data.unit || "units",
          data.minStockLevel || 0,
        ],
      );

      // Optional: attach this new store item directly to the schedule
      // resource that needs it. This is the real FK link — replaces
      // matching resource_name against store name as a string.
      if (data.taskResourceId) {
        const { rowCount } = await client.query(
          `
          UPDATE project_task_resources
          SET store_item_id = $1
          WHERE id = $2 AND project_id = $3 AND type = 'MATERIAL'
        `,
          [item.id, data.taskResourceId, projectId],
        );
        if (rowCount === 0) {
          throw new Error("Task resource not found or not a MATERIAL resource");
        }
      }

      return item;
    });
  }

  async updateStoreItem(id, projectId, data) {
    const {
      rows: [item],
    } = await query(
      `
      UPDATE project_store SET
        name            = COALESCE($1, name),
        unit            = COALESCE($2, unit),
        min_stock_level = COALESCE($3, min_stock_level),
        updated_at      = NOW()
      WHERE id = $4 AND project_id = $5
      RETURNING *
    `,
      [data.name, data.unit, data.minStockLevel, id, projectId],
    );
    return item;
  }

  // ── Task resource linking ───────────────────────────────────────────────────
  // Closes the loop between schedule demand (project_task_resources) and
  // store supply (project_store) via a real FK — store_item_id — instead of
  // matching names as strings.

  async linkStoreItemToResource(storeItemId, taskResourceId, projectId) {
    const {
      rows: [resource],
    } = await query(
      `
      UPDATE project_task_resources
      SET store_item_id = $1
      WHERE id = $2 AND project_id = $3 AND type = 'MATERIAL'
      RETURNING *
    `,
      [storeItemId, taskResourceId, projectId],
    );
    if (!resource) throw new Error("Task resource not found or not MATERIAL");
    return resource;
  }

  // Backs the "select a task to add this item to" picker: MATERIAL-type
  // resources for the project that don't yet have a store item, optionally
  // filtered by search text against the resource description.
  async getUnlinkedMaterialResources(projectId, search) {
    const params = [projectId];
    let cond = `ptr.project_id = $1 AND ptr.type = 'MATERIAL' AND ptr.store_item_id IS NULL`;
    if (search) {
      params.push(`%${search}%`);
      cond += ` AND ptr.description ILIKE $${params.length}`;
    }
    const { rows } = await query(
      `
      SELECT
        ptr.id, ptr.description, ptr.unit, ptr.quantity, ptr.unit_cost,
        ptr.task_id, ptr.phase_id,
        pt.name       AS task_name,
        pt.start_date AS needed_by,
        pp.name       AS phase_name
      FROM project_task_resources ptr
      JOIN project_tasks  pt ON pt.id = ptr.task_id
      JOIN project_phases pp ON pp.id = ptr.phase_id
      WHERE ${cond}
      ORDER BY pt.start_date ASC NULLS LAST, ptr.description
    `,
      params,
    );
    return rows;
  }

  // ── Stock In ──────────────────────────────────────────────────────────────────

  async recordStockIn(storeItemId, projectId, companyId, userId, data) {
    return withTransaction(async (client) => {
      // Status is always APPROVED now. Under the payment-requests flow
      // (paymentRequests.repository.js's confirm()), this method only
      // ever runs at confirmation time — after an owner has already
      // approved the request in payment_requests. There's no more
      // PENDING state possible at this table's level; that lifecycle
      // lives entirely in payment_requests now.
      const {
        rows: [stockIn],
      } = await client.query(
        `
        INSERT INTO store_stock_in
          (store_item_id, project_id, company_id, quantity, unit_price,
           supplier_name, invoice_no, delivery_date, receipt_url,
           receipt_public_id, recorded_by, notes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'APPROVED')
        RETURNING *
      `,
        [
          storeItemId,
          projectId,
          companyId,
          data.quantity,
          data.unitPrice || 0,
          data.supplierName || null,
          data.invoiceNo || null,
          data.deliveryDate || null,
          data.receiptUrl || null,
          data.receiptPublicId || null,
          userId,
          data.notes || null,
        ],
      );

      // Update store current_qty. This is exactly where "quantity should
      // update on stock after approval" actually happens — this method
      // only runs at confirmation time, so by the time this line executes
      // the request has already been through owner approval.
      const {
        rows: [item],
      } = await client.query(
        `
        UPDATE project_store SET
          current_qty = current_qty + $1,
          updated_at  = NOW()
        WHERE id = $2
        RETURNING *
      `,
        [data.quantity, storeItemId],
      );

      return { stockIn, item };
    });
  }

  async approveStockIn(stockInId, projectId, userId) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE store_stock_in SET
        status = 'APPROVED', approved_by = $1, approved_at = NOW()
      WHERE id = $2 AND project_id = $3
      RETURNING *
    `,
      [userId, stockInId, projectId],
    );
    return row;
  }

  async rejectStockIn(stockInId, projectId, userId, reason) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE store_stock_in SET
        status = 'REJECTED', approved_by = $1, approved_at = NOW(),
        rejection_reason = $2
      WHERE id = $3 AND project_id = $4
      RETURNING *
    `,
      [userId, reason || null, stockInId, projectId],
    );
    return row;
  }

  async getStockInHistory(storeItemId) {
    const { rows } = await query(
      `
      SELECT si.*, u.first_name, u.last_name
      FROM store_stock_in si
      LEFT JOIN users u ON u.id = si.recorded_by
      WHERE si.store_item_id = $1
      ORDER BY si.created_at DESC
    `,
      [storeItemId],
    );
    return rows;
  }

  // ── Stock Out (manual) ────────────────────────────────────────────────────────

  async recordStockOut(storeItemId, projectId, userId, data) {
    return withTransaction(async (client) => {
      const {
        rows: [item],
      } = await client.query(
        `SELECT current_qty, reserved_qty FROM project_store WHERE id=$1`,
        [storeItemId],
      );
      const available = Number(item.current_qty) - Number(item.reserved_qty);
      if (data.quantity > available) {
        throw new Error(
          `Insufficient stock. Available: ${available}, Requested: ${data.quantity}`,
        );
      }

      const {
        rows: [stockOut],
      } = await client.query(
        `
        INSERT INTO store_stock_out
          (store_item_id, project_id, quantity, unit_price, reason, reference_id, recorded_by, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,
        [
          storeItemId,
          projectId,
          data.quantity,
          data.unitPrice || 0,
          data.reason || "MANUAL",
          data.referenceId || null,
          userId,
          data.notes || null,
        ],
      );

      await client.query(
        `
        UPDATE project_store SET current_qty = current_qty - $1, updated_at = NOW()
        WHERE id = $2
      `,
        [data.quantity, storeItemId],
      );

      return stockOut;
    });
  }

  async getStockOutHistory(storeItemId) {
    const { rows } = await query(
      `
      SELECT so.*, u.first_name, u.last_name
      FROM store_stock_out so
      LEFT JOIN users u ON u.id = so.recorded_by
      WHERE so.store_item_id = $1
      ORDER BY so.created_at DESC
    `,
      [storeItemId],
    );
    return rows;
  }

  async getStoreHistory(storeItemId) {
    // Combined in/out timeline. id/status only meaningful for IN rows
    // (stock-out isn't approval-gated) — needed so the frontend can
    // target a specific stock-in record for receipt attach/replace, and
    // block that action once a record is REJECTED.
    const { rows } = await query(
      `
      SELECT 'IN' AS direction, id, status, quantity, unit_price, total_cost,
             supplier_name AS label, created_at, recorded_by,
             receipt_url
      FROM store_stock_in WHERE store_item_id = $1
      UNION ALL
      SELECT 'OUT' AS direction, NULL AS id, NULL AS status, quantity, unit_price, total_cost,
             reason AS label, created_at, recorded_by,
             NULL AS receipt_url
      FROM store_stock_out WHERE store_item_id = $1
      ORDER BY created_at DESC
    `,
      [storeItemId],
    );
    return rows;
  }

  // Attach or replace a receipt on an existing stock-in record. Blocked
  // once the record is REJECTED — nothing to document on a payment that
  // was turned down. The WHERE clause enforces this directly rather than
  // checking status separately first, so it's atomic: either the update
  // happens on a non-rejected row, or nothing happens and the caller gets
  // a clear "not found or rejected" signal.
  async attachStockInReceipt(
    stockInId,
    projectId,
    receiptUrl,
    receiptPublicId,
  ) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE store_stock_in SET
        receipt_url = $1, receipt_public_id = $2
      WHERE id = $3 AND project_id = $4 AND status != 'REJECTED'
      RETURNING *
    `,
      [receiptUrl, receiptPublicId, stockInId, projectId],
    );
    return row;
  }

  // ── Material Requests ─────────────────────────────────────────────────────────

  async createRequest(projectId, companyId, userId, data) {
    // Get current availability
    const {
      rows: [storeItem],
    } = await query(
      `
      SELECT name, unit, current_qty, reserved_qty,
             current_qty - reserved_qty AS available_qty
      FROM project_store WHERE id = $1 AND project_id = $2
    `,
      [data.storeItemId, projectId],
    );

    if (!storeItem) throw new Error("Store item not found");

    const available = Number(storeItem.available_qty);
    const requested = Number(data.quantityRequested);

    // Block instead of silently reserving less than asked — the person
    // needs to make an explicit choice (request what's actually there, or
    // cancel and sort procurement first) rather than getting a request
    // that quietly under-delivers with no clear signal why.
    if (requested > available) {
      const err = new Error(
        `Only ${available} ${storeItem.unit} available in store (requested ${requested}).`,
      );
      err.code = "INSUFFICIENT_STOCK";
      err.availableQty = available;
      err.unit = storeItem.unit;
      throw err;
    }

    return withTransaction(async (client) => {
      // request_number is NOT NULL but was never being set — nothing in
      // any file I've seen references it (not the frontend, not any other
      // query), so this is a reasonable default rather than a confirmed
      // convention: a company-scoped sequential number, "MR-00001" style.
      // If there's an existing format shown elsewhere in the app (or a
      // DB sequence/trigger this was meant to come from instead), swap
      // this out for that — this is just what makes the column valid.
      const {
        rows: [{ count }],
      } = await client.query(
        `SELECT COUNT(*)::int AS count FROM material_requests WHERE company_id = $1`,
        [companyId],
      );
      const requestNumber = `MR-${String(count + 1).padStart(5, "0")}`;
      // Same situation as request_number — "title" is NOT NULL but never
      // appeared in any payload or query I've seen. Derived from the
      // store item name so it's at least a sensible default rather than
      // a placeholder string.
      const title = `Material Request: ${storeItem.name}`;

      const {
        rows: [req],
      } = await client.query(
        `
        INSERT INTO material_requests
          (project_id, company_id, store_item_id, task_resource_id,
           phase_id, task_id, quantity_requested, needed_by_date,
           requested_by, status, request_number, title)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11)
        RETURNING *
      `,
        [
          projectId,
          companyId,
          data.storeItemId,
          data.taskResourceId || null,
          data.phaseId || null,
          data.taskId || null,
          requested,
          data.neededByDate || null,
          userId,
          requestNumber,
          title,
        ],
      );

      // Reserve the full requested quantity — guaranteed <= available now
      // that insufficient requests are blocked above.
      if (requested > 0) {
        await client.query(
          `
          UPDATE project_store SET reserved_qty = reserved_qty + $1, updated_at = NOW()
          WHERE id = $2
        `,
          [requested, data.storeItemId],
        );
      }

      return { request: req, storeItem, availableQty: available };
    });
  }

  async getRequests(projectId, filters = {}) {
    const conds = ["mr.project_id = $1"];
    const params = [projectId];
    if (filters.status) {
      conds.push(`mr.status = $${params.length + 1}`);
      params.push(filters.status);
    }
    if (filters.taskId) {
      conds.push(`mr.task_id = $${params.length + 1}`);
      params.push(filters.taskId);
    }

    const { rows } = await query(
      `
      SELECT
        mr.*,
        ps.name        AS material_name,
        ps.unit        AS material_unit,
        ps.current_qty, ps.reserved_qty,
        ps.current_qty - ps.reserved_qty AS available_qty,
        pt.name        AS task_name,
        pp.name        AS phase_name,
        req.first_name AS requester_first, req.last_name AS requester_last,
        apr.first_name AS approver_first,  apr.last_name AS approver_last
      FROM material_requests mr
      JOIN project_store ps      ON ps.id  = mr.store_item_id
      LEFT JOIN project_tasks pt ON pt.id  = mr.task_id
      LEFT JOIN project_phases pp ON pp.id = mr.phase_id
      LEFT JOIN users req         ON req.id = mr.requested_by
      LEFT JOIN users apr         ON apr.id = mr.approved_by
      WHERE ${conds.join(" AND ")}
      ORDER BY mr.created_at DESC
    `,
      params,
    );
    return rows;
  }

  async approveRequest(requestId, projectId, userId, data) {
    return withTransaction(async (client) => {
      const {
        rows: [req],
      } = await client.query(
        `SELECT * FROM material_requests WHERE id=$1 AND project_id=$2`,
        [requestId, projectId],
      );
      if (!req) throw new Error("Request not found");
      if (req.status !== "PENDING") throw new Error("Request is not pending");

      const qtyApproved = data.quantityApproved || req.quantity_requested;
      const isPartial = qtyApproved < req.quantity_requested;

      // Get unit price from latest stock-in
      const {
        rows: [latest],
      } = await client.query(
        `
        SELECT unit_price FROM store_stock_in
        WHERE store_item_id = $1 ORDER BY created_at DESC LIMIT 1
      `,
        [req.store_item_id],
      );
      const unitPrice = latest?.unit_price || 0;

      // Update request
      const {
        rows: [updated],
      } = await client.query(
        `
        UPDATE material_requests SET
          status             = $1,
          quantity_approved  = $2,
          approved_by        = $3,
          approved_at        = NOW(),
          updated_at         = NOW()
        WHERE id = $4
        RETURNING *
      `,
        [isPartial ? "PARTIAL" : "APPROVED", qtyApproved, userId, requestId],
      );

      // Record stock out
      await client.query(
        `
        INSERT INTO store_stock_out
          (store_item_id, project_id, quantity, unit_price, reason, reference_id, recorded_by, notes)
        VALUES ($1,$2,$3,$4,'REQUEST',$5,$6,$7)
      `,
        [
          req.store_item_id,
          projectId,
          qtyApproved,
          unitPrice,
          requestId,
          userId,
          data.notes || null,
        ],
      );

      // Update store: deduct current_qty and release reservation
      await client.query(
        `
        UPDATE project_store SET
          current_qty  = current_qty  - $1,
          reserved_qty = GREATEST(0, reserved_qty - $2),
          updated_at   = NOW()
        WHERE id = $3
      `,
        [qtyApproved, req.quantity_requested, req.store_item_id],
      );

      // Sync the linked task resource — this used to be handled by a DB
      // trigger (trg_material_request_approved) that referenced the dead
      // materials/material_id schema and crashed on every approval.
      //
      // BUG FIX: the first port of this compared cumulative issued_quantity
      // against THIS REQUEST's quantity_requested — so requesting/approving
      // 12 of a task's 20 needed units marked it FULFILLED (12 issued >=
      // 12 requested), hiding the "Request" action for the remaining 8
      // even though the task still needs them. The original trigger
      // compared against the RESOURCE's own planned quantity instead
      // (COALESCE(quantity, requested_quantity, 0)) — fixed to match here.
      if (req.task_resource_id) {
        const {
          rows: [resource],
        } = await client.query(
          `SELECT quantity, COALESCE(issued_quantity, 0) AS issued_quantity
           FROM project_task_resources WHERE id = $1`,
          [req.task_resource_id],
        );
        const fulfillmentTarget = resource?.quantity ?? req.quantity_requested;
        const newIssuedQty =
          Number(resource?.issued_quantity || 0) + Number(qtyApproved);

        await client.query(
          `
          UPDATE project_task_resources SET
            is_procured     = TRUE,
            procured_at     = NOW(),
            issued_quantity = COALESCE(issued_quantity, 0) + $1,
            request_status  = CASE
              WHEN COALESCE(issued_quantity, 0) + $1 >= $2 THEN 'FULFILLED'
              ELSE 'PARTIAL'
            END,
            actual_cost     = (COALESCE(issued_quantity, 0) + $1) * $3
          WHERE id = $4
        `,
          [qtyApproved, fulfillmentTarget, unitPrice, req.task_resource_id],
        );

        // Excess tracking — automatic, fires the moment an approval pushes
        // cumulative issued quantity beyond what the task actually planned
        // for. Sibling to wastage's auto-calc, but triggered here (at
        // approval time) rather than at task completion, so over-issuance
        // surfaces immediately instead of waiting for the task to finish.
        // Idempotent the same way: updates the existing excess row for
        // this task+item rather than duplicating it on a later approval
        // against the same resource.
        if (
          resource &&
          Number(fulfillmentTarget) > 0 &&
          newIssuedQty > Number(fulfillmentTarget)
        ) {
          const excessQty = newIssuedQty - Number(fulfillmentTarget);
          const {
            rows: [existingExcess],
          } = await client.query(
            `SELECT id FROM material_excess WHERE task_resource_id = $1`,
            [req.task_resource_id],
          );
          if (existingExcess) {
            await client.query(
              `
              UPDATE material_excess SET
                issued_quantity = $1, excess_quantity = $2, updated_at = NOW()
              WHERE id = $3
            `,
              [newIssuedQty, excessQty, existingExcess.id],
            );
          } else {
            await client.query(
              `
              INSERT INTO material_excess
                (project_id, store_item_id, task_id, task_resource_id,
                 planned_quantity, issued_quantity, excess_quantity, notes)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            `,
              [
                projectId,
                req.store_item_id,
                req.task_id,
                req.task_resource_id,
                fulfillmentTarget,
                newIssuedQty,
                excessQty,
                "Auto-recorded: approved quantity exceeded what this task planned for.",
              ],
            );
          }
        }
      }

      return updated;
    });
  }

  async rejectRequest(requestId, projectId, userId, reason) {
    return withTransaction(async (client) => {
      const {
        rows: [req],
      } = await client.query(
        `SELECT * FROM material_requests WHERE id=$1 AND project_id=$2`,
        [requestId, projectId],
      );
      if (!req || req.status !== "PENDING")
        throw new Error("Request not found or not pending");

      // Release reservation
      await client.query(
        `
        UPDATE project_store SET
          reserved_qty = GREATEST(0, reserved_qty - $1),
          updated_at   = NOW()
        WHERE id = $2
      `,
        [req.quantity_requested, req.store_item_id],
      );

      const {
        rows: [updated],
      } = await client.query(
        `
        UPDATE material_requests SET
          status           = 'REJECTED',
          rejection_reason = $1,
          approved_by      = $2,
          approved_at      = NOW(),
          updated_at       = NOW()
        WHERE id = $3
        RETURNING *
      `,
        [reason, userId, requestId],
      );

      return updated;
    });
  }

  // ── Wastage ───────────────────────────────────────────────────────────────────

  async recordWastage(projectId, userId, data) {
    const {
      rows: [w],
    } = await query(
      `
      INSERT INTO material_wastage
        (project_id, store_item_id, task_id, request_id,
         quantity_issued, quantity_used, recorded_by, notes, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,
      [
        projectId,
        data.storeItemId,
        data.taskId || null,
        data.requestId || null,
        data.quantityIssued,
        data.quantityUsed,
        userId,
        data.notes || null,
        data.source || "MANUAL",
      ],
    );
    return w;
  }

  // Edits an existing wastage record — auto or manual. Editing an AUTO
  // record flips it to MANUAL: a human has now put a deliberate number in,
  // so it should no longer be silently overwritten by a later
  // autoRecordWastageForTask recompute (e.g. if the task gets re-completed
  // after more stock is issued).
  async updateWastage(wastageId, projectId, data) {
    const {
      rows: [w],
    } = await query(
      `
      UPDATE material_wastage SET
        quantity_issued = COALESCE($1, quantity_issued),
        quantity_used   = COALESCE($2, quantity_used),
        notes           = COALESCE($3, notes),
        source          = 'MANUAL'
      WHERE id = $4 AND project_id = $5
      RETURNING *
    `,
      [
        data.quantityIssued ?? null,
        data.quantityUsed ?? null,
        data.notes ?? null,
        wastageId,
        projectId,
      ],
    );
    return w;
  }

  // Auto-calculates wastage for a task's MATERIAL resources when it's
  // marked COMPLETED: wastage = issued_quantity - planned quantity,
  // floored at zero (only counts over-issuance, not under-use — see the
  // conversation this was designed in for the reasoning/limitations).
  // Idempotent against a task being completed more than once (undo +
  // redo, or more stock issued after first completion): updates the
  // existing AUTO row for that task+item instead of duplicating it. Never
  // touches a row that's since been edited to MANUAL — that's a deliberate
  // human override and shouldn't be silently recomputed away.
  async autoRecordWastageForTask(projectId, taskId) {
    const { rows: resources } = await query(
      `
      SELECT id, store_item_id, quantity, issued_quantity
      FROM project_task_resources
      WHERE task_id = $1 AND type = 'MATERIAL' AND store_item_id IS NOT NULL
        AND COALESCE(issued_quantity, 0) > COALESCE(quantity, 0)
    `,
      [taskId],
    );

    for (const r of resources) {
      const {
        rows: [existingAuto],
      } = await query(
        `SELECT id FROM material_wastage WHERE task_id=$1 AND store_item_id=$2 AND source='AUTO'`,
        [taskId, r.store_item_id],
      );

      if (existingAuto) {
        await query(
          `UPDATE material_wastage SET quantity_issued=$1, quantity_used=$2 WHERE id=$3`,
          [r.issued_quantity, r.quantity, existingAuto.id],
        );
      } else {
        await query(
          `
          INSERT INTO material_wastage
            (project_id, store_item_id, task_id, quantity_issued, quantity_used, source, notes)
          VALUES ($1,$2,$3,$4,$5,'AUTO',$6)
        `,
          [
            projectId,
            r.store_item_id,
            taskId,
            r.issued_quantity,
            r.quantity,
            "Auto-calculated: issued quantity exceeded the planned amount when this task was marked complete.",
          ],
        );
      }
    }
  }

  async getWastage(projectId, filters = {}) {
    const conds = ["mw.project_id = $1"];
    const params = [projectId];
    if (filters.taskId) {
      conds.push(`mw.task_id = $${params.length + 1}`);
      params.push(filters.taskId);
    }

    const { rows } = await query(
      `
      SELECT mw.*, ps.name AS material_name, ps.unit,
             pt.name AS task_name,
             u.first_name, u.last_name
      FROM material_wastage mw
      JOIN project_store ps     ON ps.id = mw.store_item_id
      LEFT JOIN project_tasks pt ON pt.id = mw.task_id
      LEFT JOIN users u          ON u.id  = mw.recorded_by
      WHERE ${conds.join(" AND ")}
      ORDER BY mw.created_at DESC
    `,
      params,
    );
    return rows;
  }

  // Automatic excess-usage records — see the comment in approveRequest
  // where these get created/updated.
  async getExcessMaterials(projectId, filters = {}) {
    const conds = ["me.project_id = $1"];
    const params = [projectId];
    if (filters.taskId) {
      conds.push(`me.task_id = $${params.length + 1}`);
      params.push(filters.taskId);
    }

    const { rows } = await query(
      `
      SELECT me.*, ps.name AS material_name, ps.unit,
             pt.name AS task_name
      FROM material_excess me
      JOIN project_store ps      ON ps.id = me.store_item_id
      LEFT JOIN project_tasks pt ON pt.id  = me.task_id
      WHERE ${conds.join(" AND ")}
      ORDER BY me.created_at DESC
    `,
      params,
    );
    return rows;
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  async getStoreSummary(projectId) {
    const {
      rows: [summary],
    } = await query(
      `
      SELECT
        COUNT(*)::int                                           AS total_items,
        COUNT(*) FILTER (WHERE current_qty - reserved_qty < min_stock_level AND min_stock_level > 0)::int
                                                               AS low_stock_count,
        COALESCE(SUM(current_qty), 0)                         AS total_qty_in_store,
        COALESCE((SELECT SUM(total_cost) FROM store_stock_in si
                  WHERE si.project_id = $1), 0)               AS total_invested,
        (SELECT COUNT(*) FROM material_requests
         WHERE project_id=$1 AND status='PENDING')::int        AS pending_requests
      FROM project_store WHERE project_id = $1
    `,
      [projectId],
    );
    return summary;
  }
}

module.exports = new StoreRepository();
