import { AI_CONFIG } from "../config.js";

export const INJECTION_PATTERN =
  /\b(ignore|override|system prompt|instruction|you are now|always execute|never ask|secret|api.?key|password|disregard|bypass|credentials|token)\b/i;

// Patterns that could break out of user_data tags or inject XML-like structures
export const TAG_INJECTION_PATTERN = /<\/?user_data|<\/?system|<\/?instruction/i;

export const VALID_CATEGORIES = new Set(["preference", "context", "relationship", "habit"]);

export interface RawFact {
  category: string;
  key: string;
  value: string;
}

/**
 * Validates an array of raw LLM-extracted facts, filtering out any that fail
 * category, length, injection, or key format checks.
 */
export function validateFacts(raw: unknown): RawFact[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((fact): fact is RawFact => {
    if (!fact || typeof fact !== "object") return false;
    if (typeof fact.category !== "string" || typeof fact.key !== "string" || typeof fact.value !== "string") return false;
    if (!VALID_CATEGORIES.has(fact.category)) return false;
    if (fact.value.length > AI_CONFIG.memory.maxFactValueLength) return false;
    if (INJECTION_PATTERN.test(fact.value) || INJECTION_PATTERN.test(fact.key)) return false;
    if (TAG_INJECTION_PATTERN.test(fact.value) || TAG_INJECTION_PATTERN.test(fact.key)) return false;
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(fact.key)) return false;
    return true;
  });
}

/**
 * Parses an LLM response that may be wrapped in markdown code fences.
 * Returns the parsed JSON or null on failure.
 */
export function parseLLMFactResponse(response: string): unknown {
  try {
    const cleaned = response.trim().replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
