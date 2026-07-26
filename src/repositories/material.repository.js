const { query, withTransaction } = require("../config/database");
const BaseRepository = require("./base.repository");

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
       FROM materials m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.name
       LIMIT $${i++} OFFSET $${i}`,
      params,
    );
    return rows;
  }

  async findByIdWithLedger(id, companyId) {
    const { rows: mat } = await query(
      `SELECT m.*, s.name AS supplier_name, s.phone AS supplier_phone
       FROM materials m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.id = $1 AND m.company_id = $2`,
      [id, companyId],
    );
    if (!mat[0]) return null;

    // Full transaction history with task linkage
    const { rows: txs } = await query(
      `SELECT
         st.*,
         u.first_name, u.last_name,
         p.name AS project_name
       FROM stock_transactions st
       JOIN users u ON u.id = st.user_id
       LEFT JOIN projects p ON p.id = st.project_id
       WHERE st.material_id = $1
       ORDER BY st.created_at DESC
       LIMIT 50`,
      [id],
    );

    // Running balance summary
    const {
      rows: [summary],
    } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'STOCK_IN')::INT   AS total_stock_ins,
         COUNT(*) FILTER (WHERE type = 'STOCK_OUT')::INT  AS total_stock_outs,
         COALESCE(SUM(quantity) FILTER (WHERE type = 'STOCK_IN'),  0)::NUMERIC AS total_received,
         COALESCE(SUM(quantity) FILTER (WHERE type = 'STOCK_OUT'), 0)::NUMERIC AS total_issued,
         COALESCE(SUM(total_cost) FILTER (WHERE type = 'STOCK_IN'),0)::NUMERIC AS total_value_received
       FROM stock_transactions
       WHERE material_id = $1`,
      [id],
    );

    // Linked schedule resources
    const { rows: linkedResources } = await query(
      `SELECT
         ptr.id, ptr.quantity AS planned_qty, ptr.unit,
         ptr.estimated_cost, ptr.request_status, ptr.issued_quantity,
         pt.name AS task_name, pp.name AS phase_name,
         p.name AS project_name
       FROM project_task_resources ptr
       JOIN project_tasks pt  ON pt.id  = ptr.task_id
       JOIN project_phases pp ON pp.id  = ptr.phase_id
       JOIN projects p        ON p.id   = ptr.project_id
       WHERE ptr.material_id = $1
       ORDER BY ptr.created_at DESC`,
      [id],
    );

    return {
      ...mat[0],
      transactions: txs,
      summary,
      linkedResources,
    };
  }

  async getLowStock(companyId) {
    const { rows } = await query(
      `SELECT m.*, s.name AS supplier_name, s.phone AS supplier_phone
       FROM materials m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.company_id = $1
         AND m.status IN ('LOW','CRITICAL','OUT_OF_STOCK')
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
          : newQty <= parseFloat(m.min_quantity || 0) * 0.5
            ? "CRITICAL"
            : newQty <= parseFloat(m.min_quantity || 0)
              ? "LOW"
              : "OK";

      const { rows: tx } = await client.query(
        `INSERT INTO stock_transactions
           (material_id, project_id, user_id, type, quantity, unit_cost,
            total_cost, quantity_before, quantity_after, notes, receipt_url)
         VALUES ($1,$2,$3,'STOCK_IN',$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
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
        `UPDATE materials
         SET quantity=$1, unit_cost=$2,
             status=$3, updated_at=NOW()
         WHERE id=$4 RETURNING *`,
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
      const available = parseFloat(m.quantity);
      if (parseFloat(quantity) > available)
        throw new Error(
          `Insufficient stock. Available: ${available} ${m.unit}`,
        );

      const newQty = available - parseFloat(quantity);
      const status =
        newQty <= 0
          ? "OUT_OF_STOCK"
          : newQty <= parseFloat(m.min_quantity || 0) * 0.5
            ? "CRITICAL"
            : newQty <= parseFloat(m.min_quantity || 0)
              ? "LOW"
              : "OK";

      const { rows: tx } = await client.query(
        `INSERT INTO stock_transactions
           (material_id, project_id, user_id, type, quantity, unit_cost,
            total_cost, quantity_before, quantity_after, notes)
         VALUES ($1,$2,$3,'STOCK_OUT',$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id,
          projectId || null,
          userId,
          quantity,
          m.unit_cost,
          parseFloat(quantity) * parseFloat(m.unit_cost),
          available,
          newQty,
          notes || null,
        ],
      );

      const { rows: updated } = await client.query(
        `UPDATE materials
         SET quantity=$1, status=$2, updated_at=NOW()
         WHERE id=$3 RETURNING *`,
        [newQty, status, id],
      );
      return {
        transaction: tx[0],
        material: updated[0],
        statusChanged: status !== m.status,
      };
    });
  }

  async getStockHistory(
    companyId,
    { projectId, materialId, type, limit = 50, offset = 0 },
  ) {
    const conditions = ["m.company_id = $1"];
    const params = [companyId];
    let i = 2;

    if (projectId) {
      conditions.push(`st.project_id = $${i++}`);
      params.push(projectId);
    }
    if (materialId) {
      conditions.push(`st.material_id = $${i++}`);
      params.push(materialId);
    }
    if (type) {
      conditions.push(`st.type = $${i++}`);
      params.push(type);
    }

    params.push(limit, offset);

    const { rows } = await query(
      `SELECT
         st.*,
         m.name AS material_name, m.unit AS material_unit,
         u.first_name, u.last_name,
         p.name AS project_name,
         pt.name AS task_name,
         pp.name AS phase_name
       FROM stock_transactions st
       JOIN materials m ON m.id = st.material_id
       JOIN users u     ON u.id = st.user_id
       LEFT JOIN projects p ON p.id = st.project_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY st.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      params,
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO materials
         (company_id, supplier_id, name, category, unit, unit_cost,
          quantity, min_quantity, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
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

  // Get all MATERIAL resources from a project's schedule
  async getProjectMaterials(projectId, companyId) {
    // All MATERIAL type resources from this project's schedule tasks
    // Regardless of whether they are linked to store or not
    const { rows: resources } = await query(
      `
      SELECT
        ptr.id                                    AS resource_id,
        ptr.description                           AS resource_name,
        ptr.unit                                  AS resource_unit,
        ptr.quantity                              AS planned_quantity,
        ptr.estimated_cost                        AS planned_cost,
        ptr.actual_cost,
        ptr.is_procured,
        ptr.request_status,
        ptr.issued_quantity,
        ptr.requested_quantity,
        ptr.material_id,
        ptr.source,
        pt.id                                     AS task_id,
        pt.name                                   AS task_name,
        pt.status                                 AS task_status,
        pp.id                                     AS phase_id,
        pp.name                                   AS phase_name,
        -- Store material details (if linked)
        m.id                                      AS material_store_id,
        m.name                                    AS material_store_name,
        m.quantity                                AS stock_quantity,
        m.unit                                    AS stock_unit,
        m.unit_cost                               AS stock_unit_cost,
        m.status                                  AS stock_status,
        m.category,
        s.name                                    AS supplier_name,
        s.phone                                   AS supplier_phone
      FROM project_task_resources ptr
      JOIN project_tasks pt   ON pt.id  = ptr.task_id
      JOIN project_phases pp  ON pp.id  = ptr.phase_id
      LEFT JOIN materials m   ON m.id   = ptr.material_id
      LEFT JOIN suppliers s   ON s.id   = m.supplier_id
      WHERE pp.project_id = $1
        AND ptr.type = 'MATERIAL'
      ORDER BY pp.order_index ASC, pt.created_at ASC, ptr.description ASC
    `,
      [projectId],
    );

    // Split into linked (has store material) and unlinked (planned only)
    const linked = resources.filter((r) => r.material_id !== null);
    const unlinked = resources.filter((r) => r.material_id === null);

    return { linked, unlinked, all: resources };
  }

  // Auto-create a material from a schedule resource and link it
  async createFromResource(
    resourceId,
    projectId,
    companyId,
    { name, unit, unitCost, category, description },
  ) {
    return withTransaction(async (client) => {
      // Create the material
      const {
        rows: [material],
      } = await client.query(
        `
        INSERT INTO materials
          (company_id, name, category, unit, unit_cost,
           quantity, min_quantity, description, status)
        VALUES ($1, $2, $3, $4, $5, 0, 0, $6, 'OUT_OF_STOCK')
        RETURNING *
      `,
        [
          companyId,
          name,
          category || "Other",
          unit || "units",
          unitCost || 0,
          description || `Auto-created from schedule resource`,
        ],
      );

      // Link the resource to this new material
      await client.query(
        `
        UPDATE project_task_resources
        SET material_id = $1
        WHERE id = $2
      `,
        [material.id, resourceId],
      );

      return material;
    });
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

module.exports = MaterialRepository;
