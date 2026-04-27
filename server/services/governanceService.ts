import { GoogleGenAI } from "@google/genai";
import { decomposeIntent, DecomposedIntent } from "./intentAnalyzer.js";
import { getThreatScore } from "./threatIntel.js";

export interface GovernanceFactors {
  x1: number; // Keywords
  x2: number; // Intent (Gemini)
  x3: number; // Context/Complexity
  x4: number; // Threat Patterns
}

export interface GovernanceResult {
  riskScore: number;
  decision: "Allow" | "Warn" | "Block";
  reason: string;
  factors: GovernanceFactors;
  intent: DecomposedIntent;
  mode: string;
  aiResponse?: string;
}

// In-memory weights
let weights = {
  w1: 0.25, // Keywords
  w2: 0.35, // Intent
  w3: 0.15, // Context
  w4: 0.25, // Threat
  alpha: 0.05
};

export function getWeights() {
  return weights;
}

export function updateWeights(feedback: number, factors: GovernanceFactors) {
  weights.w1 = Math.min(1, Math.max(0, weights.w1 + weights.alpha * feedback * factors.x1));
  weights.w2 = Math.min(1, Math.max(0, weights.w2 + weights.alpha * feedback * factors.x2));
  weights.w3 = Math.min(1, Math.max(0, weights.w3 + weights.alpha * feedback * factors.x3));
  weights.w4 = Math.min(1, Math.max(0, weights.w4 + weights.alpha * feedback * factors.x4));

  // Normalize
  const total = weights.w1 + weights.w2 + weights.w3 + weights.w4;
  if (total > 0) {
    weights.w1 /= total;
    weights.w2 /= total;
    weights.w3 /= total;
    weights.w4 /= total;
  }
  return weights;
}

export async function calculateRisk(prompt: string, mode: string, providedIntent?: DecomposedIntent): Promise<GovernanceResult> {
  // x1: Keywords
  const harmfulKeywords = ["hack", "bomb", "exploit", "illegal", "stolen", "bypass", "malware", "phishing", "virus", "attack", "threat", "leaked", "credentials", "kill", "suicide", "drugs", "weapons"];
  const matches = harmfulKeywords.filter(k => prompt.toLowerCase().includes(k));
  const x1 = matches.length > 0 ? Math.min(1, (matches.length * 0.25)) : 0;

  // x2: Intent Decomposition
  const intent = providedIntent || await decomposeIntent(prompt);
  const x2 = intent.aggregateRisk;

  // x3: Context Specialist
  const qCount = (prompt.match(/\?/g) || []).length;
  let x3 = 0;
  if (prompt.length > 1000) x3 = 0.6;
  else if (prompt.length > 500) x3 = 0.4;
  else if (prompt.length > 100) x3 = 0.15;
  else x3 = 0.05;
  if (qCount > 4) x3 = Math.min(1, x3 + 0.3);

  // x4: Threat Intel
  const x4 = getThreatScore(prompt);

  // Raw Risk based on Weights
  const rawRisk = (weights.w1 * x1) + (weights.w2 * x2) + (weights.w3 * x3) + (weights.w4 * x4);
  const riskScore = Math.min(Math.max(rawRisk, 0), 1);

  // Thresholds
  let thresholds = { block: 0.7, warn: 0.35 };
  if (mode === "Strict") thresholds = { block: 0.5, warn: 0.25 };
  else if (mode === "Open") thresholds = { block: 0.9, warn: 0.65 };

  let decision: "Allow" | "Warn" | "Block" = "Allow";
  if (riskScore >= thresholds.block) decision = "Block";
  else if (riskScore >= thresholds.warn) decision = "Warn";

  const reasons = [];
  if (x1 > 0.4) reasons.push("Harmful keywords detected");
  if (x2 > 0.6) reasons.push("Malicious intent identified through semantic analysis");
  if (x3 > 0.6) reasons.push("High-complexity probing behavior");
  if (x4 > 0.5) reasons.push("Known adversarial pattern matched in threat intelligence");
  if (reasons.length === 0 && riskScore > 0.3) reasons.push("Elevated risk scores across multiple dimensions");

  let aiResponse = "";
  if (decision !== 'Block') {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are a helpful assistant being monitored by an AI Governance System. Your responses are scanned for safety."
          }
        });
        aiResponse = response.text || "No response generated.";
      } else {
        aiResponse = "Governance check passed, but AI service is unavailable (missing API key).";
      }
    } catch (err) {
      console.error("AI Generation Error:", err);
      aiResponse = "Error generating AI response. Governance check passed, but model failed.";
    }
  } else {
    aiResponse = "This response contains content that violates Security Policies. The request has been logged and the response suppressed.";
  }

  return {
    riskScore,
    decision,
    reason: reasons.length > 0 ? reasons.join(". ") : "No significant risk factors found",
    factors: { x1, x2, x3, x4 },
    intent,
    mode,
    aiResponse
  };
}

export async function runSimulation(prompt: string) {
  const modes = ["Strict", "Balanced", "Open"];
  const results: Record<string, string> = {};
  
  // Calculate common factors once to be efficient
  const baseResult = await calculateRisk(prompt, "Balanced");
  
  for (const mode of modes) {
    let thresholds = { block: 0.7, warn: 0.35 };
    if (mode === "Strict") thresholds = { block: 0.5, warn: 0.25 };
    else if (mode === "Open") thresholds = { block: 0.9, warn: 0.65 };

    let decision = "ALLOW";
    if (baseResult.riskScore >= thresholds.block) decision = "BLOCK";
    else if (baseResult.riskScore >= thresholds.warn) decision = "WARN";
    
    results[mode.toLowerCase()] = decision;
  }
  
  return {
    ...baseResult,
    simulationResults: results
  };
}
