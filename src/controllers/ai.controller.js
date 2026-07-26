const { asyncHandler } = require("../middleware");
const { projectRepo, budgetRepo, materialRepo } = require("../repositories");
const { NotFoundError } = require("../utils/errors");
const { query } = require("../config/database");
const Anthropic = require("@anthropic-ai/sdk");

exports.ai = {
  costPrediction: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.body.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");
    const summary = await budgetRepo.getSummary(req.body.projectId);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `You are a Nigerian construction cost analyst. Analyze this project and respond ONLY with valid JSON.
Project: ${project.name} (${project.type}) — ${project.location}
Budget: ₦${summary.total_allocated?.toLocaleString("en-NG")} | Spent: ₦${summary.total_spent?.toLocaleString("en-NG")} (${summary.percent_used}%)
Categories: ${summary.by_category?.map((b) => `${b.category}: ${b.percent_used}% used`).join(", ")}
JSON schema: {"overallHealth":"GREEN|YELLOW|RED","healthSummary":"string","projectedFinalCost":number,"projectedOverrun":number,"riskFactors":["string"],"recommendations":["string"],"categoryInsights":[{"category":"string","status":"ON_TRACK|AT_RISK|OVERSPENT","insight":"string"}]}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const analysis = JSON.parse(resp.content[0].text.match(/\{[\s\S]*\}/)[0]);
    res.json({
      success: true,
      data: { project: { id: project.id, name: project.name }, analysis },
    });
  }),

  smartReorder: asyncHandler(async (req, res) => {
    const low = await materialRepo.getLowStock(req.user.companyId);
    if (!low.length)
      return res.json({
        success: true,
        data: { recommendations: [], message: "All stock levels healthy!" },
      });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Nigerian construction procurement specialist. Respond ONLY with valid JSON.
Low stock: ${low.map((m) => `${m.name}: ${m.quantity}${m.unit} (min:${m.min_quantity}, cost:₦${m.unit_cost})`).join("; ")}
JSON: {"recommendations":[{"materialName":"string","urgency":"IMMEDIATE|THIS_WEEK|NEXT_WEEK","suggestedQty":number,"estimatedCost":number,"reason":"string"}],"totalEstimatedCost":number,"summary":"string"}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const result = JSON.parse(resp.content[0].text.match(/\{[\s\S]*\}/)[0]);
    res.json({ success: true, data: result });
  }),

  siteSummary: asyncHandler(async (req, res) => {
    const { projectId } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ rows: visitors }, { rows: expenses }, { rows: stock }] =
      await Promise.all([
        query(
          "SELECT COUNT(*) AS cnt FROM visitors WHERE project_id=$1 AND time_in >= $2",
          [projectId, today],
        ),
        query(
          "SELECT SUM(amount)::numeric AS total FROM expenses WHERE project_id=$1 AND created_at >= $2",
          [projectId, today],
        ),
        query(
          "SELECT type, COUNT(*) AS cnt FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.company_id=$1 AND st.created_at >= $2 GROUP BY type",
          [req.user.companyId, today],
        ),
      ]);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Write a 3-paragraph daily site summary for a Nigerian construction project. Professional English. Under 200 words.
Visitors today: ${visitors[0]?.cnt || 0}
Expenses today: ₦${Number(expenses[0]?.total || 0).toLocaleString("en-NG")}
Stock movements: ${stock.map((s) => `${s.cnt} ${s.type}`).join(", ") || "none"}`;
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    res.json({
      success: true,
      data: {
        summary: resp.content[0].text,
        generatedAt: new Date().toISOString(),
      },
    });
  }),
};
