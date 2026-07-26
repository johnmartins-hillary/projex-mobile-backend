const { query } = require("../config/database");

class BillingRepository {
  async getSubscription(companyId) {
    const { rows } = await query(
      "SELECT * FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1",
      [companyId],
    );
    return rows[0] || null;
  }

  async createSubscription(data) {
    const { rows } = await query(
      `INSERT INTO subscriptions (company_id,plan,status,paystack_ref,amount)
       VALUES ($1,$2,'PENDING',$3,$4) RETURNING *`,
      [data.companyId, data.plan, data.paystackRef, data.amount],
    );
    return rows[0];
  }

  async activateSubscription(paystackRef, { subCode, expiresAt }) {
    const { rows } = await query(
      `UPDATE subscriptions SET status='ACTIVE', paystack_sub_code=$1, started_at=NOW(), expires_at=$2, updated_at=NOW()
       WHERE paystack_ref=$3 RETURNING *`,
      [subCode || null, expiresAt, paystackRef],
    );
    return rows[0];
  }

  async recordPayment(data) {
    const { rows } = await query(
      `INSERT INTO payments (company_id,subscription_id,paystack_ref,amount,status,paid_at,metadata)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6) ON CONFLICT (paystack_ref) DO NOTHING RETURNING *`,
      [
        data.companyId,
        data.subscriptionId || null,
        data.paystackRef,
        data.amount,
        data.status,
        JSON.stringify(data.metadata || {}),
      ],
    );
    return rows[0];
  }

  async getPaymentHistory(companyId) {
    const { rows } = await query(
      "SELECT * FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 20",
      [companyId],
    );
    return rows;
  }
}

module.exports = BillingRepository;
