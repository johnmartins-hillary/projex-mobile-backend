const express = require("express");
const { body } = require("express-validator");
const { protect, validate, asyncHandler } = require("../middleware");
const ctrl = require("../controllers");

const router = express.Router();

// POST /ai/cost-prediction
router.post(
  "/cost-prediction",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.ai.costPrediction,
);

// POST /ai/smart-reorder
router.post("/smart-reorder", protect, ctrl.ai.smartReorder);

// POST /ai/site-summary
router.post(
  "/site-summary",
  protect,
  [body("projectId").isUUID(), validate],
  ctrl.ai.siteSummary,
);

// POST /ai/estimate
router.post(
  "/estimate",
  protect,
  asyncHandler(async (req, res) => {
    const { buildingType, size, location, quality, floors, description } =
      req.body;
    if (!buildingType || !size) {
      return res
        .status(400)
        .json({ success: false, message: "buildingType and size required" });
    }
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `You are an expert Nigerian quantity surveyor and construction cost estimator with 20+ years experience in Lagos, Abuja, Port Harcourt and other Nigerian cities.

A client wants to estimate the cost of a construction project with these details:
- Building Type: ${buildingType}
- Total Floor Area: ${size} sqm
- Number of Floors: ${floors || 1}
- Location: ${location || "Lagos, Nigeria"}
- Quality Level: ${quality || "Standard"}
- Additional Details: ${description || "None"}

Provide a detailed construction cost estimate in Nigerian Naira (NGN) for ${new Date().getFullYear()}.

Respond ONLY with a valid JSON object in this exact format:
{
  "summary": { "totalCost": 150000000, "costPerSqm": 750000, "buildingType": "3 Bedroom Bungalow", "size": 200, "location": "Lagos", "quality": "Standard", "estimatedDuration": "8-12 months", "confidence": "Medium" },
  "breakdown": [
    { "category": "Preliminaries & Site Setup", "percentage": 5, "amount": 7500000, "details": "Site clearing, hoarding, mobilisation, temporary facilities" },
    { "category": "Substructure (Foundation)", "percentage": 15, "amount": 22500000, "details": "Excavation, concrete foundation, DPC, backfill" },
    { "category": "Superstructure (Frame)", "percentage": 20, "amount": 30000000, "details": "Columns, beams, slabs, walls, roofing" },
    { "category": "Roofing", "percentage": 8, "amount": 12000000, "details": "Roof structure, long span sheets, gutters" },
    { "category": "Finishes", "percentage": 20, "amount": 30000000, "details": "Plastering, tiling, painting, ceilings, doors, windows" },
    { "category": "Mechanical & Plumbing", "percentage": 10, "amount": 15000000, "details": "Water supply, drainage, sanitary fittings, overhead tank" },
    { "category": "Electrical", "percentage": 10, "amount": 15000000, "details": "Wiring, conduits, fittings, distribution board, lighting" },
    { "category": "External Works", "percentage": 7, "amount": 10500000, "details": "Fence, gate, compound paving, landscaping" },
    { "category": "Contingency (5%)", "percentage": 5, "amount": 7500000, "details": "Unforeseen works and price fluctuations" }
  ],
  "assumptions": ["Prices based on current Lagos market rates", "Standard sand-crete block construction", "Long span aluminum roofing sheets", "Ceramic floor tiles throughout"],
  "disclaimer": "This is an AI-generated estimate. Actual costs may vary based on site conditions, material price changes, and design specifications. Always obtain professional QS report."
}

Make sure all amounts are realistic for Nigerian construction in ${new Date().getFullYear()}. The percentages must add up to 100. All amounts must add up to totalCost.`;

    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res
        .status(500)
        .json({ success: false, message: "Could not parse AI response" });
    }
    res.json({ success: true, data: JSON.parse(jsonMatch[0]) });
  }),
);

module.exports = router;
