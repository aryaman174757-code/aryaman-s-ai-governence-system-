import { GoogleGenAI, Type } from "@google/genai";

export interface DecomposedIntent {
  goal: string;
  method: string;
  target: string;
  goalRisk: number;
  methodRisk: number;
  targetRisk: number;
  aggregateRisk: number;
}

export async function decomposeIntent(prompt: string): Promise<DecomposedIntent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY missing, skipping backend decomposition");
    return {
      goal: "N/A (Backend)",
      method: "N/A (Backend)",
      target: "N/A (Backend)",
      goalRisk: 0,
      methodRisk: 0,
      targetRisk: 0,
      aggregateRisk: 0
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `
        Decompose and analyze the following user prompt for security governance:
        1. Goal: What the user is trying to achieve.
        2. Method: How they intend to achieve it.
        3. Target: Who or what is the subject/object of the action.

        For each component, provide a risk score between 0 (safe) and 1 (malicious).
        Also provide an aggregateRisk score between 0 and 1.

        Prompt: "${prompt}"

        Return ONLY a JSON object with keys: "goal", "method", "target", "goalRisk", "methodRisk", "targetRisk", "aggregateRisk".
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            goal: { type: Type.STRING },
            method: { type: Type.STRING },
            target: { type: Type.STRING },
            goalRisk: { type: Type.NUMBER },
            methodRisk: { type: Type.NUMBER },
            targetRisk: { type: Type.NUMBER },
            aggregateRisk: { type: Type.NUMBER },
          },
          required: ["goal", "method", "target", "goalRisk", "methodRisk", "targetRisk", "aggregateRisk"]
        }
      }
    });

    const text = response.text;
    if (text) {
      return JSON.parse(text);
    }
    
    throw new Error("Empty response from Gemini");
  } catch (error) {
    console.error("Intent Decomposition Error:", error);
    return {
      goal: "Error",
      method: "Error",
      target: "Error",
      goalRisk: 0.5,
      methodRisk: 0.5,
      targetRisk: 0.5,
      aggregateRisk: 0.5
    };
  }
}
