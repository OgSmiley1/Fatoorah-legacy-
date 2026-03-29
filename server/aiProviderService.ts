/**
 * Provider-agnostic AI service.
 * Primary: Google Gemini free tier (gemini-2.0-flash-exp)
 * Fallback: Groq free tier (llama-3.3-70b-versatile)
 *
 * Switching is automatic — no manual intervention needed.
 * Each response includes which provider handled it.
 */

import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIResponse {
  text: string;
  provider: "gemini" | "groq" | "none";
}

const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

async function tryGemini(messages: AIMessage[], systemPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });

  // Build Gemini-format contents from history
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
      temperature: 0.7
    }
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

async function tryGroq(messages: AIMessage[], systemPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const payload = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ],
    max_tokens: 1024,
    temperature: 0.7
  };

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data: any = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned empty response");
  return text;
}

/**
 * Send a chat message through the best available free AI provider.
 * Tries Gemini first, falls back to Groq on any failure.
 */
export async function chat(messages: AIMessage[], systemPrompt: string): Promise<AIResponse> {
  // Try Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await tryGemini(messages, systemPrompt);
      logger.info("ai_provider_used", { provider: "gemini" });
      return { text, provider: "gemini" };
    } catch (err: any) {
      logger.warn("ai_gemini_failed_falling_back", { error: err.message });
    }
  }

  // Fallback: Groq
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await tryGroq(messages, systemPrompt);
      logger.info("ai_provider_used", { provider: "groq" });
      return { text, provider: "groq" };
    } catch (err: any) {
      logger.error("ai_groq_failed", { error: err.message });
      throw new Error(`All AI providers failed. Gemini and Groq both unavailable.`);
    }
  }

  // No keys configured
  logger.warn("ai_no_provider_configured", {});
  return {
    text: "No AI provider is configured. Add `GEMINI_API_KEY` (free at aistudio.google.com) or `GROQ_API_KEY` (free at console.groq.com) to your `.env` file.",
    provider: "none"
  };
}
