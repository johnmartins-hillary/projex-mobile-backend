// backend/src/repositories/paymentRequests.repository.js
const { query } = require("../config/database");
const storeRepo = require("./store.repository"); // singleton export
const LabourRepository = require("./labour.repository"); // class export
const SubcontractsRepository = require("./subcontracts.repository"); // class export

const labourRepo = new LabourRepository();
const subcontractsRepo = new SubcontractsRepository();

class PaymentRequestsRepository {
  // ── Create ────────────────────────────────────────────────────────────────
  // Nothing else exists yet at this point — no stock-in/log/payment row.
  // `payload` carries everything needed to create that record later, at
  // confirmation. `amount` is computed here so the unified list/history
  // views don't need to reach into the JSONB for something this common.
  async create(type, projectId, companyId, userId, payload, notes) {
    const amount = this._computeAmount(type, payload);
    const {
      rows: [row],
    } = await query(
      `
      INSERT INTO payment_requests
        (type, project_id, company_id, amount, status, payload, notes, requested_by)
      VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)
      RETURNING *
    `,
      [
        type,
        projectId,
        companyId,
        amount,
        JSON.stringify(payload),
        notes || null,
        userId,
      ],
    );
    return row;
  }

  _computeAmount(type, payload) {
    if (type === "STOCK_IN") {
      return Number(payload.quantity || 0) * Number(payload.unitPrice || 0);
    }
    if (type === "LABOUR") {
      return (
        Number(payload.headcount || 0) * Number(payload.dayRate || 0) +
        Number(payload.excessAmount || 0)
      );
    }
    if (type === "SUBCONTRACT") {
      return Number(payload.amount || 0);
    }
    return 0;
  }

  // ── List ──────────────────────────────────────────────────────────────────
  // One table now — no more UNION across three log tables. entity_name and
  // other display fields are read out of `payload` by the controller/
  // frontend rather than joined, since for PENDING/APPROVED requests
  // there's no child row yet to join to.
  async getRequests(companyId, filters = {}) {
    const status = filters.status || "PENDING";
    const params = [companyId, status];
    let projectFilter = "";
    if (filters.projectId) {
      params.push(filters.projectId);
      projectFilter = `AND pr.project_id = $${params.length}`;
    }
    let typeFilter = "";
    if (filters.type) {
      params.push(filters.type);
      typeFilter = `AND pr.type = $${params.length}`;
    }

    const { rows } = await query(
      `
      SELECT pr.*,
        p.name AS project_name,
        u.first_name, u.last_name,
        au.first_name AS approver_first_name, au.last_name AS approver_last_name,
        cu.first_name AS completer_first_name, cu.last_name AS completer_last_name
      FROM payment_requests pr
      JOIN projects p        ON p.id = pr.project_id
      LEFT JOIN users u      ON u.id = pr.requested_by
      LEFT JOIN users au     ON au.id = pr.approved_by
      LEFT JOIN users cu     ON cu.id = pr.completed_by
      WHERE pr.company_id = $1 AND pr.status = $2 ${projectFilter} ${typeFilter}
      ORDER BY COALESCE(pr.completed_at, pr.approved_at, pr.created_at) DESC
    `,
      params,
    );
    return rows;
  }

  async getById(id, projectId) {
    const {
      rows: [row],
    } = await query(
      `SELECT * FROM payment_requests WHERE id = $1 AND project_id = $2`,
      [id, projectId],
    );
    return row;
  }

  // Kept for dashboard.repository.js's existing call site.
  async getPendingRequests(companyId, projectId) {
    return this.getRequests(companyId, { status: "PENDING", projectId });
  }

  // ── Approve / reject the REQUEST itself ─────────────────────────────────
  // Neither creates anything — approval only unlocks the one-tap confirm
  // action; rejection ends it here with nothing ever created.

  async approve(id, projectId, userId) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE payment_requests SET
        status = 'APPROVED', approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND project_id = $3 AND status = 'PENDING'
      RETURNING *
    `,
      [userId, id, projectId],
    );
    return row;
  }

  async reject(id, projectId, userId, reason) {
    const {
      rows: [row],
    } = await query(
      `
      UPDATE payment_requests SET
        status = 'REJECTED', approved_by = $1, approved_at = NOW(),
        rejection_reason = $2, updated_at = NOW()
      WHERE id = $3 AND project_id = $4 AND status = 'PENDING'
      RETURNING *
    `,
      [userId, reason || null, id, projectId],
    );
    return row;
  }

  // ── Confirm — the one-tap action ────────────────────────────────────────
  // Only reachable on an APPROVED request. Creates the real record (stock
  // quantity moves here, for STOCK_IN — not at request or approval time),
  // attaches the receipt, and marks the request COMPLETED with a pointer
  // to what got created.
  async confirm(id, projectId, userId, receiptUrl, receiptPublicId) {
    const request = await this.getById(id, projectId);
    if (!request) return null;
    if (request.status !== "APPROVED") {
      const err = new Error(
        request.status === "PENDING"
          ? "This request hasn't been approved yet."
          : request.status === "REJECTED"
            ? "This request was rejected."
            : "This request has already been confirmed.",
      );
      err.code = "INVALID_STATE";
      throw err;
    }

    const payload = request.payload;
    let linkedRecord;

    if (request.type === "STOCK_IN") {
      const result = await storeRepo.recordStockIn(
        payload.storeItemId,
        projectId,
        request.company_id,
        userId,
        {
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
          supplierName: payload.supplierName,
          invoiceNo: payload.invoiceNo,
          deliveryDate: payload.deliveryDate,
          notes: payload.notes,
          receiptUrl,
          receiptPublicId,
        },
      );
      linkedRecord = result.stockIn;
    } else if (request.type === "LABOUR") {
      linkedRecord = await labourRepo.createLog(
        projectId,
        request.company_id,
        userId,
        {
          trade: payload.trade,
          headcount: payload.headcount,
          dayRate: payload.dayRate,
          logDate: payload.logDate,
          phaseId: payload.phaseId,
          taskId: payload.taskId,
          taskResourceId: payload.taskResourceId,
          notes: payload.notes,
          excessAmount: payload.excessAmount,
          excessReason: payload.excessReason,
          receiptUrl,
          receiptPublicId,
        },
      );
    } else if (request.type === "SUBCONTRACT") {
      linkedRecord = await subcontractsRepo.createPayment(
        payload.subcontractId,
        userId,
        {
          amount: payload.amount,
          paymentDate: payload.paymentDate,
          paymentMethod: payload.paymentMethod,
          reference: payload.reference,
          milestoneId: payload.milestoneId,
          notes: payload.notes,
          receiptUrl,
          receiptPublicId,
        },
      );
    } else {
      throw new Error(`Unknown payment request type: ${request.type}`);
    }

    const {
      rows: [updated],
    } = await query(
      `
      UPDATE payment_requests SET
        status = 'COMPLETED', receipt_url = $1, receipt_public_id = $2,
        completed_by = $3, completed_at = NOW(), linked_record_id = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `,
      [receiptUrl, receiptPublicId, userId, linkedRecord.id, id],
    );

    return updated;
  }
}

module.exports = PaymentRequestsRepository;
