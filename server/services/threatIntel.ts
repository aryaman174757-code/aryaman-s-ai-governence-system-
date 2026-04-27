import { adminDb } from "../config/firebase-admin.js";

interface ThreatPattern {
  id: string;
  pattern: string;
  type: "jailbreak" | "adversarial" | "unsafe";
  weight: number;
}

let cachedPatterns: ThreatPattern[] = [
  // Default patterns in case DB is empty
  { id: "default_1", pattern: "ignore previous instructions", type: "jailbreak", weight: 0.9 },
  { id: "default_2", pattern: "system override", type: "jailbreak", weight: 0.95 },
  { id: "default_3", pattern: "DAN mode", type: "adversarial", weight: 0.8 },
];

async function refreshPatterns() {
  try {
    const snapshot = await adminDb.collection("threat_patterns").get();
    if (!snapshot.empty) {
      const patterns: ThreatPattern[] = [];
      snapshot.forEach(doc => {
        patterns.push({ id: doc.id, ...doc.data() } as ThreatPattern);
      });
      cachedPatterns = patterns;
      console.log(`Threat patterns refreshed: ${cachedPatterns.length} patterns loaded.`);
    }
  } catch (error) {
    console.error("Error refreshing threat patterns:", error);
  }
}

// Auto-refresh every 10 minutes
setInterval(refreshPatterns, 10 * 60 * 1000);
refreshPatterns(); // Initial fetch

export function getThreatScore(prompt: string): number {
  const lowercasePrompt = prompt.toLowerCase();
  let maxScore = 0;

  for (const item of cachedPatterns) {
    if (lowercasePrompt.includes(item.pattern.toLowerCase())) {
      maxScore = Math.max(maxScore, item.weight);
    }
  }

  return maxScore;
}

export function getAllPatterns() {
  return cachedPatterns;
}
