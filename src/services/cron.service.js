const cron = require("node-cron");
const { query: q } = require("../config/database");
const {
  generateWeeklyReport,
  formatWhatsAppReport,
} = require("./weeklyReport.service");
const { logger } = require("../utils/logger");

// ── Featured placement renewal ──────────────────────────────────────────────
const renewFeaturedPlacements = async () => {
  logger.info("CRON: Checking featured placements for renewal...");
  try {
    const { rows: due } = await q(
      `SELECT fp.*, u.email AS supplier_email
       FROM featured_placements fp
       JOIN supplier_profiles sp ON sp.id = fp.supplier_id
       JOIN users u ON u.id = sp.user_id
       WHERE fp.is_active = TRUE
       AND fp.auto_renew = TRUE
       AND fp.paystack_authorization_code IS NOT NULL
       AND fp.ends_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'`,
    );

    logger.info(`CRON: Found ${due.length} placements due for renewal`);

    for (const placement of due) {
      try {
        const priceKey =
          placement.type === "STORE"
            ? "featured_store_price_monthly"
            : "featured_product_price_weekly";

        const { rows: priceRows } = await q(
          "SELECT value FROM platform_settings WHERE key = $1",
          [priceKey],
        );
        const amount = parseInt(
          priceRows[0]?.value ||
            (placement.type === "STORE" ? "15000" : "5000"),
        );
        const durationDays = placement.type === "STORE" ? 30 : 7;

        const chargeRes = await fetch(
          "https://api.paystack.co/transaction/charge_authorization",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              authorization_code: placement.paystack_authorization_code,
              email: placement.supplier_email,
              amount: amount * 100,
              reference: `feat_renew_${placement.id}_${Date.now()}`,
              metadata: {
                type: placement.type,
                supplierId: placement.supplier_id,
                placementId: placement.id,
                renewal: true,
              },
            }),
          },
        );

        const chargeData = await chargeRes.json();

        if (chargeData.status && chargeData.data?.status === "success") {
          const newStart = new Date(placement.ends_at);
          const newEnd = new Date(
            newStart.getTime() + durationDays * 24 * 60 * 60 * 1000,
          );

          await q(
            `UPDATE featured_placements SET
               starts_at = $1, ends_at = $2,
               renewal_count = renewal_count + 1,
               last_renewed_at = NOW(),
               payment_status = 'SUCCESS',
               updated_at = NOW()
             WHERE id = $3`,
            [newStart, newEnd, placement.id],
          );

          await q(
            `INSERT INTO featured_placement_payments
               (featured_placement_id, supplier_id, paystack_ref,
                paystack_authorization_code, amount, status,
                period_start, period_end, paid_at)
             VALUES ($1, $2, $3, $4, $5, 'SUCCESS', $6, $7, NOW())`,
            [
              placement.id,
              placement.supplier_id,
              chargeData.data.reference,
              placement.paystack_authorization_code,
              amount,
              newStart,
              newEnd,
            ],
          );

          logger.info(
            `CRON: Renewed placement ${placement.id} (${placement.type}) until ${newEnd.toISOString()}`,
          );
        } else {
          await q(
            `UPDATE featured_placements SET auto_renew = FALSE, updated_at = NOW() WHERE id = $1`,
            [placement.id],
          );

          await q(
            `INSERT INTO featured_placement_payments
               (featured_placement_id, supplier_id, paystack_ref,
                amount, status, period_start, period_end)
             VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)`,
            [
              placement.id,
              placement.supplier_id,
              `failed_renew_${placement.id}_${Date.now()}`,
              amount,
              placement.ends_at,
              new Date(
                new Date(placement.ends_at).getTime() +
                  durationDays * 24 * 60 * 60 * 1000,
              ),
            ],
          );

          logger.warn(
            `CRON: Renewal FAILED for placement ${placement.id} — auto_renew disabled. Reason: ${chargeData.data?.gateway_response || chargeData.message}`,
          );
        }
      } catch (err) {
        logger.error(
          `CRON: Error renewing placement ${placement.id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    logger.error("CRON: renewFeaturedPlacements error:", err.message);
  }
};

// ── Expire lapsed placements ────────────────────────────────────────────────
const expireFeaturedPlacements = async () => {
  logger.info("CRON: Expiring lapsed featured placements...");
  try {
    const { rows: expired } = await q(
      `UPDATE featured_placements
       SET is_active = FALSE, updated_at = NOW()
       WHERE is_active = TRUE
       AND ends_at < NOW()
       AND (auto_renew = FALSE OR paystack_authorization_code IS NULL)
       RETURNING id, product_id, type`,
    );

    for (const p of expired) {
      if (p.product_id) {
        await q(
          "UPDATE supplier_products SET is_featured = FALSE WHERE id = $1",
          [p.product_id],
        );
      }
    }

    if (expired.length > 0) {
      logger.info(`CRON: Expired ${expired.length} placements`);
    }
  } catch (err) {
    logger.error("CRON: expireFeaturedPlacements error:", err.message);
  }
};

// ── Register all cron jobs ──────────────────────────────────────────────────
const startCronJobs = () => {
  // Weekly report — every Monday at 7:00 AM WAT (UTC+1 = 6:00 AM UTC)
  cron.schedule("0 6 * * 1", async () => {
    logger.info("Running weekly report cron job...");
    try {
      const { rows: companies } = await q(
        "SELECT DISTINCT c.id FROM companies c JOIN projects p ON p.company_id=c.id WHERE p.status='ACTIVE'",
      );

      for (const company of companies) {
        const data = await generateWeeklyReport(company.id);
        if (!data) continue;

        const message = formatWhatsAppReport(data);

        const { rows: ownerRows } = await q(
          `SELECT u.phone FROM users u
           WHERE u.company_id=$1
           AND u.role IN ('SUPER_ADMIN','PROJECT_OWNER')
           AND u.is_active=TRUE
           ORDER BY u.created_at ASC LIMIT 1`,
          [company.id],
        );

        if (ownerRows[0]?.phone) {
          logger.info(`Weekly report generated for company ${company.id}`);
          await q(
            `INSERT INTO notifications (company_id, title, message, type, data)
             SELECT id, 'Weekly Report Ready', $1, 'WEEKLY_REPORT', '{}'
             FROM companies WHERE id=$2`,
            [message.substring(0, 500), company.id],
          ).catch(() => {});
        }
      }

      logger.info("Weekly report cron job completed");
    } catch (e) {
      logger.error("Weekly report cron failed:", e);
    }
  });

  // Mark overdue invoices — every day at 7:00 AM
  cron.schedule("0 7 * * *", async () => {
    try {
      await q(
        `UPDATE invoices SET status='OVERDUE', updated_at=NOW()
         WHERE status='SENT' AND due_date < CURRENT_DATE`,
      );
      logger.info("Overdue invoices updated");
    } catch (e) {
      logger.error("Overdue invoice cron failed:", e);
    }
  });

  // Featured placement renewal — every 30 minutes
  cron.schedule("*/30 * * * *", renewFeaturedPlacements);

  // Expire lapsed placements — every hour at :05 past
  cron.schedule("5 * * * *", expireFeaturedPlacements);

  logger.info(
    "Cron jobs started: weekly reports, overdue invoices, featured renewals, placement expiry",
  );
};

module.exports = {
  startCronJobs,
  renewFeaturedPlacements,
  expireFeaturedPlacements,
};
