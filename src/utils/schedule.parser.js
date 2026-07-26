/**
 * schedule.parser.js — V7
 *
 * Two upload paths:
 *
 * PATH 1 — .xlsx (MS Project Excel export)
 *   In MS Project:
 *     1. Format → uncheck "Project Summary Task"
 *     2. (Recommended) On the Resource Sheet, fill the "Group" column with
 *        one of: Labour, Equipment, Material, Subcontract — this is used as
 *        the authoritative category for every resource. Without it, Projex
 *        falls back to the resource's Type (Work/Material/Cost) plus a
 *        best-effort name-based guess for Labour vs Equipment, which is
 *        inherently imperfect (e.g. "Poker Vibrator" and "Mason" both have
 *        Type=Work with no other structural signal to tell them apart).
 *     3. File → Save As → Excel Workbook (.xlsx)
 *   Uses "Outline Level" column for hierarchy.
 *
 * PATH 2 — .xml (Primavera P6 XML export)
 *   In P6: File → Export → Primavera PM XML
 *   Uses WBS hierarchy from P6 WBS nodes. P6's ResourceType field is
 *   structured (Labor/Material/Nonlabor), so it doesn't have the same
 *   Group-column ambiguity the Excel path does.
 *
 * Outline Level rules (Excel):
 *   1 → top-level phase
 *   2 → sub-phase (if next row is level 3) OR task (if next row is level 1/2)
 *   3 → task under sub-phase
 *
 * How resources map to Projex's 4 types, and what each looks like in the UI:
 *
 *   LABOUR      — quantity = number of workers (from the assignment's
 *                 Units% ÷ 100, e.g. 200% → 2 workers). durationDays =
 *                 how many days they're needed (from Work hours ÷ 8).
 *                 Displayed as "2 workers for 3 days".
 *   EQUIPMENT   — same shape as LABOUR, but quantity = number of machines.
 *                 Displayed as "1 machine for 3 days".
 *   MATERIAL    — quantity + unit kept exactly as exported (e.g. "8 Bag"),
 *                 no conversion. Displayed as "8 Bag of Cement". unit
 *                 prefers the Resource Table's "Material Label" column
 *                 over whatever text followed the number in the
 *                 assignment, since Material Label is the more reliable,
 *                 consistently-spelled source.
 *   SUBCONTRACT — treated as a lump sum: quantity 1, no duration.
 */

"use strict";

const XLSX = require("xlsx");
const { DOMParser } = require("@xmldom/xmldom");

// ── Helpers ───────────────────────────────────────────────────────────────────

const toISO = (val) => {
  if (!val) return null;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d)
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};

const parseDuration = (val) => {
  if (!val) return null;
  const s = String(val);
  const days = s.match(/([\d.]+)\s*d(ay)?/i);
  if (days) return Math.round(parseFloat(days[1]));
  const hrs = s.match(/([\d.]+)\s*h(r|our)?/i);
  if (hrs) return Math.round(parseFloat(hrs[1]) / 8);
  const wks = s.match(/([\d.]+)\s*w(k|eek)?/i);
  if (wks) return Math.round(parseFloat(wks[1]) * 5);
  const num = parseFloat(s);
  return isNaN(num) ? null : Math.round(num);
};

// ── Resource categorization ───────────────────────────────────────────────────

const VALID_PROJEX_TYPES = new Set([
  "LABOUR",
  "MATERIAL",
  "EQUIPMENT",
  "SUBCONTRACT",
]);

// Normalizes whatever text ended up in the Resource Table's "Group" column
// (case, common misspellings/plurals) into one of Projex's 4 types, or null
// if it's blank/unrecognized — null means "fall back to Type + name guess".
const normalizeGroup = (group) => {
  const g = (group || "").toUpperCase().trim();
  if (!g) return null;
  if (g === "LABOR") return "LABOUR";
  if (g === "MATERIALS") return "MATERIAL";
  if (g === "EQUIPMENTS") return "EQUIPMENT";
  if (
    [
      "SUBCONTRACTOR",
      "SUBCONTRACTORS",
      "SUB-CONTRACT",
      "SUB CONTRACT",
    ].includes(g)
  )
    return "SUBCONTRACT";
  return VALID_PROJEX_TYPES.has(g) ? g : null;
};

// Fallback ONLY for Work-type resources with no Group filled in — Type
// already tells us MATERIAL vs everything-else, and Cost-type resources are
// treated as SUBCONTRACT directly, so this never needs to consider either
// of those; it only has to decide LABOUR vs EQUIPMENT vs (rarely)
// SUBCONTRACT among named people/machines/services.
const classifyWorkResource = (name) => {
  const n = (name || "").toLowerCase();
  if (
    /crane|excavator|bulldozer|pump|paver|roller|compactor|truck|generator|machine|equipment|plant|loader|mixer|scaffold|ladder|tool|drill|cutter|bender|hammer|crowbar|wheelbarrow|vehicle|station|theodolite|tape|vibrat|pickaxe|shovel|cutlass|laptop|printer|computer/i.test(
      n,
    )
  )
    return "EQUIPMENT";
  if (/contractor|subcontract|specialist|authority|inspector/i.test(n))
    return "SUBCONTRACT";
  return "LABOUR";
};

// The one function that decides a resource's Projex type: Group column
// first (authoritative, if filled in), then Type (Work/Material/Cost),
// then — only for ambiguous Work-type resources — a name-based guess.
const resolveResourceCategory = (resMeta, name) => {
  const fromGroup = normalizeGroup(resMeta?.group);
  if (fromGroup) return fromGroup;
  if (resMeta?.msType === "Material") return "MATERIAL";
  if (resMeta?.msType === "Cost") return "SUBCONTRACT";
  return classifyWorkResource(name);
};

const normalizeWeights = (phases) => {
  const top = phases.filter((p) => p.outlineLevel === 1);
  const w = Math.floor(100 / top.length);
  const rem = 100 - w * top.length;
  let first = true;
  return phases.map((p) => {
    if (p.outlineLevel !== 1) return p;
    const weight = first ? w + rem : w;
    first = false;
    return { ...p, weight };
  });
};

// ── MS Project Excel Export Parser ────────────────────────────────────────────
// Reads three sheets: Task_Table, Resource_Table, Assignment_Table
// Falls back to single-sheet if only one sheet present

const parseMSProjectExcel = (buffer) => {
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: false,
  });

  // ── Detect sheet names (MS Project export uses Task_Table etc) ──────────────
  const sheetNames = wb.SheetNames;
  const taskSheet = sheetNames.find((s) => /task/i.test(s)) || sheetNames[0];
  const resSheet = sheetNames.find((s) => /resource/i.test(s));
  const assignSheet = sheetNames.find((s) => /assign/i.test(s));

  const ws = wb.Sheets[taskSheet];
  if (!ws) throw new Error("No task sheet found in Excel file.");

  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  if (!rows.length) throw new Error("Task sheet is empty.");

  // Validate required columns
  const headers = Object.keys(rows[0]);
  if (!headers.includes("Outline Level") || !headers.includes("Name")) {
    // Try "Task Name" as fallback
    if (!headers.includes("Task Name")) {
      throw new Error(
        'Missing columns. Expected "Outline Level" and "Name" (or "Task Name").\n\n' +
          "Export from MS Project:\n" +
          '1. Format → uncheck "Project Summary Task"\n' +
          "2. File → Save As → Excel Workbook (.xlsx)",
      );
    }
  }

  const nameCol = headers.includes("Name") ? "Name" : "Task Name";

  // ── Build resource metadata map from Resource_Table ─────────────────────────
  // resourceMap: name → { msType, group, materialLabel, ratePerDay, ratePerUnit, costPerUse }
  //   msType        — MS Project's own Type column: Work | Material | Cost
  //   group         — raw text from the "Group" column, if the export fills
  //                   it in (see file header comment) — takes priority over
  //                   everything else when resolving a Projex type
  //   materialLabel — MS Project's "Material Label" column, the canonical
  //                   unit for MATERIAL resources (e.g. "Bag", "m³")
  //   ratePerDay    — for Work/Cost resources: Standard Rate normalized to
  //                   a per-day figure (an hourly rate is ×8'd)
  //   ratePerUnit   — for Material resources: Standard Rate as a plain
  //                   per-unit price (materials have no /d or /h suffix —
  //                   "₦12,000.00" means twelve thousand naira per Bag,
  //                   not per day)
  //   costPerUse    — MS Project's "Cost Per Use" column — the actual
  //                   amount field for Type=Cost resources (SUBCONTRACT).
  //                   Standard Rate doesn't semantically apply to these;
  //                   this is what's usually populated instead.
  const resourceMap = new Map();
  if (resSheet && wb.Sheets[resSheet]) {
    const resRows = XLSX.utils.sheet_to_json(wb.Sheets[resSheet], {
      defval: "",
      raw: false,
    });
    for (const r of resRows) {
      const name = String(r["Name"] || "").trim();
      if (!name) continue;
      const msType = String(r["Type"] || "Work").trim(); // Work | Material | Cost
      const group = String(r["Group"] || "").trim();
      const materialLabel = String(r["Material Label"] || "").trim();
      const rateStr = String(r["Standard Rate"] || "0");

      // MS Project's Type=Cost resources (-> SUBCONTRACT) don't use
      // Standard Rate at all — their amount lives in "Cost Per Use",
      // MS Project's dedicated field for lump-sum resources. Checked
      // under a couple of header spellings since exports vary.
      const costPerUseStr = String(
        r["Cost Per Use"] || r["Cost/Use"] || r["CostPerUse"] || "0",
      );
      const costPerUse = parseFloat(costPerUseStr.replace(/[^\d.]/g, "")) || 0;

      let ratePerDay = 0;
      let ratePerUnit = 0;

      if (msType === "Material") {
        // Materials: plain per-unit price, no /d or /h suffix.
        const cleaned = rateStr.replace(/[^\d.]/g, "");
        ratePerUnit = parseFloat(cleaned) || 0;
      } else {
        // Work/Cost: "₦22,000.00/d" or "₦60,000.00/h"
        const rateMatch = rateStr.match(/([\d,]+\.?\d*)\/(d|h)/i);
        const rateVal = rateMatch
          ? parseFloat(rateMatch[1].replace(/,/g, ""))
          : 0;
        const isDaily = rateMatch ? rateMatch[2].toLowerCase() === "d" : false;
        ratePerDay = isDaily ? rateVal : rateVal * 8;
        if (!rateMatch) {
          // Cost-type resources sometimes carry a flat number with no
          // /d or /h suffix at all (a lump-sum item, not a day rate) —
          // used as-is, not multiplied by anything.
          const flat = parseFloat(rateStr.replace(/[^\d.]/g, ""));
          if (!isNaN(flat) && flat > 0) ratePerDay = flat;
        }
      }

      resourceMap.set(name, {
        msType,
        group,
        materialLabel,
        ratePerDay,
        ratePerUnit,
        costPerUse,
      });
    }
  }

  // ── Build assignment map from Assignment_Table ──────────────────────────────
  // assignMap: taskName → [{ resName, workStr, unitsStr }]
  //   Kept as RAW strings rather than pre-parsed numbers, because MATERIAL
  //   assignments and LABOUR/EQUIPMENT/SUBCONTRACT assignments use these
  //   two columns completely differently:
  //     MATERIAL rows: Work="8 Bag", Units="8 Bag" — a quantity + unit,
  //       identical in both columns.
  //     Everyone else: Work="24h" (duration in hours), Units="200%"
  //       (percentage allocation — how many of that resource are assigned).
  //   Parsing happens per-resource in buildResources, once we know which
  //   category we're dealing with.
  const assignMap = new Map();
  if (assignSheet && wb.Sheets[assignSheet]) {
    const asnRows = XLSX.utils.sheet_to_json(wb.Sheets[assignSheet], {
      defval: "",
      raw: false,
    });
    for (const a of asnRows) {
      const taskName = String(a["Task Name"] || "").trim();
      const resName = String(a["Resource Name"] || "").trim();
      if (!taskName || !resName) continue;
      if (!assignMap.has(taskName)) assignMap.set(taskName, []);
      assignMap.get(taskName).push({
        resName,
        workStr: String(a["Work"] || "").trim(),
        unitsStr: String(a["Units"] || "").trim(),
        costStr: String(a["Cost"] || "").trim(),
      });
    }
  }

  // ── Build resources for a task from assignments ─────────────────────────────
  const buildResources = (taskName) => {
    const assignments = assignMap.get(taskName) || [];
    return assignments.map(({ resName, workStr, unitsStr, costStr }) => {
      const resMeta = resourceMap.get(resName);
      const category = resolveResourceCategory(resMeta, resName);

      if (category === "MATERIAL") {
        // "8 Bag" / "3 m³" / "0.04 ton" → quantity 8/3/0.04, trailing text
        // is a fallback unit if Material Label wasn't filled in.
        const qtyMatch = String(workStr || unitsStr || "").match(
          /^([\d.]+)\s*(.*)$/,
        );
        const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : null;
        const parsedUnit = qtyMatch ? qtyMatch[2].trim() : "";
        const unit = resMeta?.materialLabel || parsedUnit || "units";
        const unitCost = resMeta?.ratePerUnit || null;

        return {
          type: "MATERIAL",
          description: resName,
          unit,
          quantity,
          unitCost,
          durationDays: null,
          sourceUnit: parsedUnit || unit || null,
          estimatedCost: quantity && unitCost ? quantity * unitCost : 0,
          source: "MSPROJECT",
        };
      }

      // LABOUR / EQUIPMENT / SUBCONTRACT
      const workMatch = String(workStr || "0").match(/([\d.]+)\s*(h|d)/i);
      const workHours = workMatch
        ? parseFloat(workMatch[1]) *
          (workMatch[2].toLowerCase() === "d" ? 8 : 1)
        : 0;
      const durationDays =
        workHours > 0 ? Math.round((workHours / 8) * 10) / 10 : null;

      const unitsMatch = String(unitsStr || "").match(/([\d.]+)\s*%/);
      const percentUnits = unitsMatch ? parseFloat(unitsMatch[1]) : null;

      let quantity;
      let unit;
      if (category === "SUBCONTRACT") {
        // Lump sum — a subcontract line isn't "N workers for M days".
        quantity = 1;
        unit = "lump sum";
      } else {
        // 200% → 2 workers/machines. Falls back to 1 if Units wasn't
        // filled in at all, rather than leaving quantity empty.
        quantity =
          percentUnits !== null ? Math.round(percentUnits / 100) || 1 : 1;
        unit = category === "LABOUR" ? "workers" : "machines";
      }

      let unitCost;
      if (category === "SUBCONTRACT") {
        // Cost-type resources don't carry a day rate — MS Project's
        // Standard Rate field doesn't semantically apply to them. The
        // amount lives either directly on the assignment (a "Cost"
        // column, when the export includes one) or on the resource's
        // "Cost Per Use". Standard Rate's flat-number reading (ratePerDay)
        // is kept as a last-resort fallback for exports that put a plain
        // lump sum there instead.
        const assignmentCost = costStr
          ? parseFloat(costStr.replace(/[^\d.]/g, "")) || null
          : null;
        unitCost =
          assignmentCost || resMeta?.costPerUse || resMeta?.ratePerDay || null;
      } else {
        unitCost = resMeta?.ratePerDay || null;
      }

      const estimatedCost =
        category === "SUBCONTRACT"
          ? unitCost || 0
          : quantity * (durationDays || 1) * (unitCost || 0);

      return {
        type: category,
        description: resName,
        unit,
        quantity,
        unitCost,
        durationDays: category === "SUBCONTRACT" ? null : durationDays,
        sourceUnit: unitsStr || null,
        estimatedCost,
        source: "MSPROJECT",
      };
    });
  };

  // ── Parse task rows ─────────────────────────────────────────────────────────
  const tasks = [];
  const taskNameCounts = new Map();
  for (const row of rows) {
    const level = parseInt(String(row["Outline Level"] || "0")) || 0;
    const name = String(row[nameCol] || "").trim();
    if (!name || level === 0) continue; // skip project summary row (level 0)

    const duration = parseDuration(row["Duration"]);

    // Task names are the ONLY join key Assignment_Table gives us back to
    // Task_Table (no shared ID column) — a repeated task name means every
    // occurrence pulls the SAME assignments, which is silently wrong if
    // they're actually different tasks that happen to share a name. Track
    // this so it can be surfaced as a warning rather than failing quietly.
    taskNameCounts.set(name, (taskNameCounts.get(name) || 0) + 1);

    tasks.push({
      level,
      name,
      startDate: toISO(row["Start"]) || toISO(row["Start Date"]),
      endDate: toISO(row["Finish"]) || toISO(row["Finish Date"]),
      durationDays: duration,
      isMilestone: duration === 0,
      predecessors: String(row["Predecessors"] || "").trim() || null,
      resources: buildResources(name),
    });
  }

  if (!tasks.length)
    throw new Error(
      "No tasks found. Check that Outline Level and Name columns are filled.",
    );

  const duplicateTaskNames = [...taskNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  // ── Build hierarchy using look-ahead ────────────────────────────────────────
  // A row is a sub-phase if the next row has a higher outline level
  const isSubPhase = (idx) => {
    const next = tasks[idx + 1];
    return next && next.level > tasks[idx].level;
  };

  const phases = [];
  const phaseStack = {}; // level → current phase/subphase at that level

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (task.level === 1) {
      const phase = {
        name: task.name,
        weight: 0,
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
        outlineLevel: 1,
        parentName: null,
        sourceId: `L1-${i}`,
        tasks: [],
      };
      phases.push(phase);
      phaseStack[1] = phase;
      phaseStack[2] = null;
    } else if (task.level === 2) {
      const parent = phaseStack[1];
      if (!parent) continue;

      if (isSubPhase(i)) {
        // Sub-phase
        const sub = {
          name: task.name,
          weight: 0,
          startDate: task.startDate,
          endDate: task.endDate,
          durationDays: task.durationDays,
          isMilestone: false,
          outlineLevel: 2,
          parentName: parent.name,
          sourceId: `L2-${i}`,
          tasks: [],
        };
        phases.push(sub);
        phaseStack[2] = sub;
      } else {
        // Direct task under phase
        phaseStack[2] = null;
        parent.tasks.push({
          name: task.name,
          startDate: task.startDate,
          endDate: task.endDate,
          durationDays: task.durationDays,
          isMilestone: task.isMilestone,
          predecessors: task.predecessors,
          sourceId: `L2-${i}`,
          resources: task.resources,
        });
      }
    } else {
      // Level 3+ → task under nearest parent
      const target =
        phaseStack[task.level - 1] || phaseStack[2] || phaseStack[1];
      if (!target) continue;
      target.tasks.push({
        name: task.name,
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
        predecessors: task.predecessors,
        sourceId: `L${task.level}-${i}`,
        resources: task.resources,
      });
    }
  }

  if (!phases.length)
    throw new Error(
      "No phases found. Outline Level 1 rows define phases.\n" +
        'Make sure "Project Summary Task" is unchecked before exporting.',
    );

  const warnings = [];
  if (duplicateTaskNames.length) {
    warnings.push(
      `${duplicateTaskNames.length} task name(s) appear more than once ` +
        `(${duplicateTaskNames.slice(0, 5).join(", ")}${duplicateTaskNames.length > 5 ? ", ..." : ""}). ` +
        `Resource assignments are matched by task name, so duplicate names ` +
        `may have picked up each other's resources. Rename duplicates to be ` +
        `unique and re-upload if the resource lists for these tasks look wrong.`,
    );
  }

  return { phases: normalizeWeights(phases), warnings };
};

// ── XML sanitizer — removes duplicate attributes that xmldom rejects ────────────

const sanitizeXml = (xml) => {
  // Strip BOM if present
  xml = xml.replace(/^\uFEFF/, "");
  // Remove duplicate attributes — use \S+? to catch ANY attribute name
  // including those with namespace prefixes or unusual characters
  return xml.replace(/<([^>/][^>]*)>/g, (match, inner) => {
    if (inner[0] === "/" || inner[0] === "?") return match;
    const seen = new Set();
    const cleaned = inner.replace(
      /(\S+?)\s*=\s*(?:"[^"]*"|'[^']*')/g,
      (attrMatch, name) => {
        if (seen.has(name)) return "";
        seen.add(name);
        return attrMatch;
      },
    );
    return "<" + cleaned + ">";
  });
};

// ── Primavera P6 XML Parser ───────────────────────────────────────────────────
// P6's ResourceType is a structured field (Labor/Material/Nonlabor), not
// free text, so it doesn't have the Group-column ambiguity the Excel path
// does — left as-is.

const parseP6XML = (buffer) => {
  const xml = sanitizeXml(buffer.toString("utf8"));
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const getText = (el, tag) => {
    const node = el.getElementsByTagName(tag)[0];
    return node ? (node.textContent || "").trim() : "";
  };
  const getAll = (parent, tag) => {
    const out = [];
    const nodes = parent.getElementsByTagName(tag);
    for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
    return out;
  };

  const wbsNodes = getAll(doc, "WBS");
  if (!wbsNodes.length)
    throw new Error(
      "No WBS elements found.\n" +
        "Export from P6: File → Export → Primavera PM XML (.xml)",
    );

  // Build WBS map
  const wbsMap = new Map();
  for (const wbs of wbsNodes) {
    const id = getText(wbs, "ObjectId");
    const parentId = getText(wbs, "ParentObjectId");
    const code = getText(wbs, "Code");
    const name = getText(wbs, "Name") || code;
    wbsMap.set(id, { id, parentId, code, name, level: 0, tasks: [] });
  }

  // Assign levels
  const getLevel = (entry) => {
    if (!entry.parentId || !wbsMap.has(entry.parentId)) return 1;
    return 1 + getLevel(wbsMap.get(entry.parentId));
  };
  for (const [, entry] of wbsMap) entry.level = getLevel(entry);

  // Resource assignment map
  const activityResourceMap = new Map();
  for (const asgn of getAll(doc, "ResourceAssignment")) {
    const actId = getText(asgn, "ActivityObjectId");
    const resName = getText(asgn, "ResourceName") || getText(asgn, "Role");
    const units = Number(getText(asgn, "PlannedUnits") || 0);
    const cost = Number(getText(asgn, "PlannedCost") || 0);
    const resType = getText(asgn, "ResourceType");
    if (!resName) continue;
    const mapped =
      resType === "Labor"
        ? "LABOUR"
        : resType === "Material"
          ? "MATERIAL"
          : "EQUIPMENT";
    if (!activityResourceMap.has(actId)) activityResourceMap.set(actId, []);
    activityResourceMap.get(actId).push({
      type: mapped,
      description: resName,
      unit:
        mapped === "MATERIAL"
          ? "units"
          : mapped === "LABOUR"
            ? "workers"
            : "machines",
      quantity: units || null,
      unitCost: units > 0 ? cost / units : null,
      durationDays: null,
      sourceUnit: null,
      estimatedCost: cost,
      source: "P6",
    });
  }

  // Map activities to WBS
  for (const act of getAll(doc, "Activity")) {
    const wbsId = getText(act, "WBSObjectId");
    const name = getText(act, "Name");
    const actId = getText(act, "ObjectId");
    const type = getText(act, "Type");
    const startStr =
      getText(act, "StartDate") || getText(act, "PlannedStartDate");
    const endStr =
      getText(act, "FinishDate") || getText(act, "PlannedFinishDate");
    const durHrs = Number(getText(act, "PlannedDuration") || 0);
    if (type === "WBS Summary" || !name) continue;
    const entry = wbsMap.get(wbsId);
    if (!entry) continue;
    entry.tasks.push({
      name,
      startDate: startStr ? startStr.split("T")[0] : null,
      endDate: endStr ? endStr.split("T")[0] : null,
      durationDays: durHrs > 0 ? Math.round(durHrs / 8) : null,
      isMilestone: type === "Start Milestone" || type === "Finish Milestone",
      predecessors: null,
      sourceId: actId,
      resources: activityResourceMap.get(actId) || [],
    });
  }

  // Build flat phases array sorted by level
  const phases = [];
  const sorted = [...wbsMap.values()].sort((a, b) => a.level - b.level);

  for (const entry of sorted) {
    const parentEntry = wbsMap.get(entry.parentId);
    phases.push({
      name: entry.name,
      weight: 0,
      startDate: null,
      endDate: null,
      durationDays: null,
      isMilestone: false,
      outlineLevel: entry.level,
      parentName: parentEntry?.name || null,
      sourceId: entry.id,
      tasks: entry.tasks,
    });
  }

  // Keep only WBS nodes with content
  const hasContent = (id) => {
    const e = wbsMap.get(id);
    if (!e) return false;
    if (e.tasks.length > 0) return true;
    return [...wbsMap.values()].some(
      (c) => c.parentId === id && hasContent(c.id),
    );
  };

  const filtered = phases.filter((p) => hasContent(p.sourceId));
  if (!filtered.length)
    throw new Error(
      "No activities found in P6 XML.\n" +
        "Make sure the export includes activities.",
    );

  return { phases: normalizeWeights(filtered), warnings: [] };
};

// ── Auto-detect and parse ─────────────────────────────────────────────────────

const detectAndParse = (buffer, originalName, mimeType) => {
  // Always use file extension first — never rely on mimetype alone
  // xlsx files can have mimetype containing "xml" which causes false routing
  const ext = (originalName || "").split(".").pop()?.toLowerCase();

  if (ext === "xlsx" || ext === "xls") {
    const { phases, warnings } = parseMSProjectExcel(buffer);
    return { format: "excel", phases, warnings };
  }

  if (ext === "xml") {
    const { phases, warnings } = parseP6XML(buffer);
    return { format: "p6xml", phases, warnings };
  }

  // Fallback to mimetype only if no recognizable extension
  if (
    (mimeType || "").includes("spreadsheet") ||
    (mimeType || "").includes("excel")
  ) {
    const { phases, warnings } = parseMSProjectExcel(buffer);
    return { format: "excel", phases, warnings };
  }

  if ((mimeType || "").includes("xml")) {
    const { phases, warnings } = parseP6XML(buffer);
    return { format: "p6xml", phases, warnings };
  }

  throw new Error(
    `Unsupported file: .${ext}.\n` +
      `Upload:\n` +
      `  • .xlsx — MS Project: File → Save As → Excel Workbook\n` +
      `  • .xml  — Primavera P6: File → Export → Primavera PM XML`,
  );
};

module.exports = { detectAndParse, parseMSProjectExcel, parseP6XML };
