const { asyncHandler } = require("../middleware");
const { projectRepo, budgetRepo } = require("../repositories");
const { NotFoundError, AppError } = require("../utils/errors");
const { query } = require("../config/database");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

// ── PDF Helpers ───────────────────────────────────────────────

const drawHeader = (doc, title, subtitle) => {
  doc.fillColor("#0A2342").rect(0, 0, doc.page.width, 80).fill();
  doc.fillColor("#FF6A00").rect(0, 76, doc.page.width, 4).fill();
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("PROJEX", 40, 20);
  doc
    .font("Helvetica")
    .fontSize(10)
    .text("Smart Construction Management", 40, 47);
  doc
    .fillColor("#0A2342")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(title, 40, 110);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#5D6D7E")
    .text(subtitle, 40, 130)
    .text(
      `Generated: ${new Date().toLocaleDateString("en-NG", { dateStyle: "long" })}`,
      40,
      146,
    );
  doc
    .strokeColor("#FF6A00")
    .lineWidth(1)
    .moveTo(40, 163)
    .lineTo(doc.page.width - 40, 163)
    .stroke();
  return 178;
};

const drawTable = (doc, headers, rows, startY) => {
  const cw = (doc.page.width - 80) / headers.length;
  let y = startY;
  doc
    .fillColor("#0A2342")
    .rect(40, y, doc.page.width - 80, 22)
    .fill();
  doc.fillColor("white").fontSize(9).font("Helvetica-Bold");
  headers.forEach((h, i) =>
    doc.text(h, 44 + i * cw, y + 6, { width: cw - 4, ellipsis: true }),
  );
  y += 22;
  rows.forEach((row, ri) => {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 60;
    }
    doc
      .fillColor(ri % 2 === 0 ? "#F4F6F7" : "white")
      .rect(40, y, doc.page.width - 80, 20)
      .fill();
    doc.fillColor("#0A2342").fontSize(8).font("Helvetica");
    row.forEach((cell, i) =>
      doc.text(String(cell ?? "-"), 44 + i * cw, y + 5, {
        width: cw - 4,
        ellipsis: true,
      }),
    );
    y += 20;
  });
  return y + 12;
};

// ── Controller ────────────────────────────────────────────────

exports.reports = {
  materialsPDF: asyncHandler(async (req, res) => {
    const { rows: txs } = await query(
      `SELECT st.*, m.name AS material_name, m.unit, u.first_name, u.last_name, p.name AS project_name
       FROM stock_transactions st JOIN materials m ON m.id=st.material_id
       JOIN users u ON u.id=st.user_id LEFT JOIN projects p ON p.id=st.project_id
       WHERE m.company_id=$1 ORDER BY st.created_at DESC LIMIT 500`,
      [req.user.companyId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=materials-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(
      doc,
      "Material Usage Report",
      `${txs.length} transactions`,
    );
    const headers = [
      "Date",
      "Material",
      "Type",
      "Qty",
      "Unit Cost (₦)",
      "Total (₦)",
      "Project",
      "By",
    ];
    const rows = txs.map((t) => [
      new Date(t.created_at).toLocaleDateString("en-NG"),
      t.material_name,
      t.type.replace("_", " "),
      `${t.quantity} ${t.unit}`,
      Number(t.unit_cost).toLocaleString("en-NG"),
      Number(t.total_cost).toLocaleString("en-NG"),
      t.project_name || "-",
      `${t.first_name} ${t.last_name[0]}.`,
    ]);
    drawTable(doc, headers, rows, y);
    doc.end();
  }),

  budgetPDF: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) throw new AppError("projectId required", 400);
    const project = await projectRepo.findById(projectId, req.user.companyId);
    if (!project) throw new NotFoundError("Project");
    const summary = await budgetRepo.getSummary(projectId);
    const { rows: expenses } = await query(
      "SELECT * FROM expenses WHERE project_id=$1 AND status='APPROVED' ORDER BY expense_date DESC",
      [projectId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=budget-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(doc, "Budget & Expense Report", project.name);
    doc
      .fillColor("#0A2342")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Budget Summary", 40, y);
    y += 16;
    const bHeaders = [
      "Category",
      "Allocated (₦)",
      "Spent (₦)",
      "Remaining (₦)",
      "% Used",
    ];
    const bRows = summary.by_category.map((b) => [
      b.category,
      Number(b.allocated).toLocaleString("en-NG"),
      Number(b.actual_spent).toLocaleString("en-NG"),
      Number(b.remaining).toLocaleString("en-NG"),
      `${b.percent_used}%`,
    ]);
    y = drawTable(doc, bHeaders, bRows, y);
    doc
      .fillColor("#0A2342")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Expense Transactions", 40, y + 8);
    y += 24;
    const eHeaders = [
      "Date",
      "Category",
      "Description",
      "Amount (₦)",
      "Status",
    ];
    const eRows = expenses
      .slice(0, 30)
      .map((e) => [
        new Date(e.expense_date).toLocaleDateString("en-NG"),
        e.category,
        e.description.slice(0, 35),
        Number(e.amount).toLocaleString("en-NG"),
        e.status,
      ]);
    drawTable(doc, eHeaders, eRows, y);
    doc.end();
  }),

  visitorsPDF: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) throw new AppError("projectId required", 400);
    const project = await projectRepo.findById(projectId, req.user.companyId);
    if (!project) throw new NotFoundError("Project");
    const { rows: visitors } = await query(
      "SELECT v.*, u.first_name, u.last_name FROM visitors v JOIN users u ON u.id=v.logged_by_id WHERE v.project_id=$1 ORDER BY v.time_in DESC LIMIT 200",
      [projectId],
    );
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=visitors-${Date.now()}.pdf`,
    );
    doc.pipe(res);
    let y = drawHeader(doc, "Visitor Activity Report", project.name);
    const headers = [
      "Name",
      "Company",
      "Purpose",
      "Time In",
      "Time Out",
      "Duration",
      "Status",
    ];
    const rows = visitors.map((v) => [
      v.full_name,
      v.company || "-",
      v.purpose,
      new Date(v.time_in).toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      v.time_out
        ? new Date(v.time_out).toLocaleTimeString("en-NG", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "On Site",
      v.duration_mins
        ? `${Math.floor(v.duration_mins / 60)}h ${v.duration_mins % 60}m`
        : "-",
      v.status,
    ]);
    drawTable(doc, headers, rows, y);
    doc.end();
  }),

  materialsExcel: asyncHandler(async (req, res) => {
    const { rows: materials } = await query(
      "SELECT m.*, s.name AS supplier_name FROM materials m LEFT JOIN suppliers s ON s.id=m.supplier_id WHERE m.company_id=$1 ORDER BY m.name",
      [req.user.companyId],
    );
    const { rows: txs } = await query(
      "SELECT st.*, m.name AS material_name, m.unit FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.company_id=$1 ORDER BY st.created_at DESC LIMIT 1000",
      [req.user.companyId],
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        materials.map((m) => ({
          Name: m.name,
          Category: m.category,
          Unit: m.unit,
          Qty: Number(m.quantity),
          "Min Qty": Number(m.min_quantity),
          "Unit Cost (₦)": Number(m.unit_cost),
          "Total Value (₦)": Number(m.quantity) * Number(m.unit_cost),
          Status: m.status,
          Supplier: m.supplier_name || "-",
        })),
      ),
      "Materials",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        txs.map((t) => ({
          Date: new Date(t.created_at).toLocaleDateString("en-NG"),
          Material: t.material_name,
          Type: t.type,
          Quantity: Number(t.quantity),
          Unit: t.unit,
          "Unit Cost (₦)": Number(t.unit_cost),
          "Total (₦)": Number(t.total_cost),
        })),
      ),
      "Transactions",
    );
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=materials-${Date.now()}.xlsx`,
    );
    res.send(buf);
  }),
};
