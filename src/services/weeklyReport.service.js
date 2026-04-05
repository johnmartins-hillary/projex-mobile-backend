const { query: q } = require("../config/database");
const { logger } = require("../utils/logger");

const generateWeeklyReport = async (companyId) => {
  try {
    // Get company info
    const { rows: companyRows } = await q(
      "SELECT * FROM companies WHERE id=$1",
      [companyId],
    );
    const company = companyRows[0];
    if (!company) return null;

    // Get active projects
    const { rows: projects } = await q(
      "SELECT * FROM projects WHERE company_id=$1 AND status='ACTIVE'",
      [companyId],
    );

    if (!projects.length) return null;

    const reportData = [];

    for (const project of projects) {
      // Budget summary
      const { rows: budgetRows } = await q(
        `SELECT 
          COALESCE(SUM(allocated), 0) AS total_allocated,
          COALESCE(SUM(spent), 0) AS total_spent,
          ROUND((COALESCE(SUM(spent),0) / NULLIF(SUM(allocated),0)) * 100) AS pct_used
         FROM budgets WHERE project_id=$1`,
        [project.id],
      );
      const budget = budgetRows[0];

      // This week expenses
      const { rows: expRows } = await q(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
         FROM expenses
         WHERE project_id=$1
         AND created_at >= NOW() - INTERVAL '7 days'
         AND status='APPROVED'`,
        [project.id],
      );
      const weekExpenses = expRows[0];

      // Pending expenses
      const { rows: pendingRows } = await q(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
         FROM expenses WHERE project_id=$1 AND status='PENDING'`,
        [project.id],
      );
      const pending = pendingRows[0];

      // Materials status
      const { rows: matRows } = await q(
        `SELECT 
    COUNT(*) AS total,
    COUNT(CASE WHEN status='LOW' THEN 1 END) AS low,
    COUNT(CASE WHEN status IN ('CRITICAL','OUT_OF_STOCK') THEN 1 END) AS critical
   FROM materials WHERE company_id=$1`,
        [companyId],
      );
      const materials = matRows[0];

      // This week attendance
      const { rows: attRows } = await q(
        `SELECT COUNT(DISTINCT employee_id) AS workers,
    ROUND(AVG(hours_worked)::numeric, 1) AS avg_hours
   FROM attendances
   WHERE project_id=$1
   AND check_in >= NOW() - INTERVAL '7 days'`,
        [project.id],
      );
      const attendance = attRows[0];

      // Open defects
      const { rows: defectRows } = await q(
        `SELECT 
          COUNT(CASE WHEN status='OPEN' THEN 1 END) AS open,
          COUNT(CASE WHEN priority='CRITICAL' AND status!='RESOLVED' THEN 1 END) AS critical
         FROM defects WHERE project_id=$1`,
        [project.id],
      );
      const defects = defectRows[0];

      // Pending material requests
      const { rows: mrRows } = await q(
        `SELECT COUNT(*) AS count FROM material_requests
         WHERE project_id=$1 AND status='PENDING'`,
        [project.id],
      );
      const materialRequests = mrRows[0];

      reportData.push({
        project,
        budget,
        weekExpenses,
        pending,
        materials,
        attendance,
        defects,
        materialRequests,
      });
    }

    return { company, projects: reportData };
  } catch (e) {
    logger.error("Weekly report generation failed:", e);
    return null;
  }
};

const formatWhatsAppReport = (data) => {
  const { company, projects } = data;
  const week = new Date().toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  let msg = `📊 *WEEKLY SITE REPORT*\n`;
  msg += `*${company.name}*\n`;
  msg += `Week ending: ${week}\n\n`;

  for (const pd of projects) {
    const {
      project,
      budget,
      weekExpenses,
      pending,
      materials,
      attendance,
      defects,
      materialRequests,
    } = pd;
    const pct = budget.pct_used || 0;
    const budgetEmoji = pct > 90 ? "🔴" : pct > 75 ? "🟡" : "🟢";

    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `🏗️ *${project.name}*\n\n`;

    msg += `💰 *Budget*\n`;
    msg += `${budgetEmoji} Allocated: ₦${Number(budget.total_allocated).toLocaleString("en-NG")}\n`;
    msg += `• Spent: ₦${Number(budget.total_spent).toLocaleString("en-NG")} (${pct}%)\n`;
    msg += `• Remaining: ₦${(Number(budget.total_allocated) - Number(budget.total_spent)).toLocaleString("en-NG")}\n\n`;

    msg += `📈 *This Week*\n`;
    msg += `• ${weekExpenses.count} expenses totalling ₦${Number(weekExpenses.total).toLocaleString("en-NG")}\n`;
    if (pending.count > 0) {
      msg += `• ⏳ ${pending.count} pending approvals (₦${Number(pending.total).toLocaleString("en-NG")})\n`;
    }
    msg += `\n`;

    msg += `📦 *Materials*\n`;
    msg += `• ${materials.total} items tracked\n`;
    if (materials.low > 0) msg += `• 🟡 ${materials.low} low stock\n`;
    if (materials.critical > 0)
      msg += `• 🔴 ${materials.critical} critical/out of stock\n`;
    msg += `\n`;

    if (Number(attendance.workers) > 0) {
      msg += `👷 *Attendance*\n`;
      msg += `• ${attendance.workers} workers this week\n`;
      if (attendance.avg_hours)
        msg += `• Avg ${attendance.avg_hours}h per worker\n`;
      msg += `\n`;
    }

    if (Number(defects.open) > 0 || Number(defects.critical) > 0) {
      msg += `🔍 *Defects*\n`;
      msg += `• ${defects.open} open defects\n`;
      if (defects.critical > 0)
        msg += `• 🔴 ${defects.critical} critical unresolved\n`;
      msg += `\n`;
    }

    if (Number(materialRequests.count) > 0) {
      msg += `📋 *${materialRequests.count} material request(s) pending approval*\n\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━\n`;
  msg += `_Generated by Projex · ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}_`;

  return msg;
};

module.exports = { generateWeeklyReport, formatWhatsAppReport };
