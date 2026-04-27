import express from "express";
import { calculateRisk, runSimulation, getWeights, updateWeights } from "../services/governanceService.js";
import { exportAnalysis } from "../controllers/exportController.js";

const router = express.Router();

router.get("/weights", (req, res) => {
  res.json(getWeights());
});

router.post("/governance", async (req, res) => {
  const { prompt, mode, simulate, intent } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });
  
  try {
    let result;
    if (simulate) {
      result = await runSimulation(prompt); // runSimulation could be updated but for now it will just use the internal calculation
    } else {
      result = await calculateRisk(prompt, mode || "Balanced", intent);
    }
    res.json(result);
  } catch (err) {
    console.error("Governance Error:", err);
    res.status(500).json({ error: "Governance processing failed" });
  }
});

router.post("/feedback", (req, res) => {
  const { feedback, factors } = req.body;
  if (feedback !== undefined && factors) {
    const weights = updateWeights(feedback, factors);
    return res.json({ status: "success", weights });
  }
  res.status(400).json({ error: "Feedback and factors required" });
});

router.post("/export", exportAnalysis);

export default router;
