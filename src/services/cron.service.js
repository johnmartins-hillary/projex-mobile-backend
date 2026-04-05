const cron = require("node-cron");
const { query: q } = require("../config/database");
const {
  generateWeeklyReport,
  formatWhatsAppReport,
} = require("./weeklyReport.service");
const { logger } = require("../utils/logger");

const startCronJobs = () => {
  // Weekly report — every Monday at 7:00 AM WAT (UTC+1 = 6:00 AM UTC)
  cron.schedule("0 6 * * 1", async () => {
    logger.info("Running weekly report cron job...");
    try {
      // Get all active companies
      const { rows: companies } = await q(
        "SELECT DISTINCT c.id FROM companies c JOIN projects p ON p.company_id=c.id WHERE p.status='ACTIVE'",
      );

      for (const company of companies) {
        const data = await generateWeeklyReport(company.id);
        if (!data) continue;

        const message = formatWhatsAppReport(data);

        // Get company owner phone number
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
          // Store report in DB for in-app viewing
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

  // Mark overdue invoices — every day at 8:00 AM
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

  logger.info("Cron jobs started");
};

module.exports = { startCronJobs };
