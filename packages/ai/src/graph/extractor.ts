import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { ExtendedPrismaClient } from "@brett/api-core";
import type { ExtractionResult } from "./types.js";
import { VALID_GRAPH_ENTITY_TYPES, VALID_RELATIONSHIP_TYPES } from "./types.js";
import { resolveModel } from "../router.js";
import { logUsage } from "../memory/usage.js";
import { INJECTION_PATTERN, TAG_INJECTION_PATTERN } from "../memory/validation.js";
import { SECURITY_BLOCK } from "../context/system-prompts.js";

export const GRAPH_EXTRACTION_PROMPT = `${SECURITY_BLOCK}

Extract entities and relationships from this content. Return a JSON object with two arrays.

## Entity Types
person, company, project, topic, tool, location

## Relationship Types
works_at, manages, owns, blocks, related_to, discussed_in, produced_by, reports_to, collaborates_with, uses, part_of, depends_on

## Output Format
{"entities": [{"type": "person", "name": "Jordan Chen"}], "relationships": [{"sourceType": "person", "sourceName": "Jordan Chen", "relationship": "works_at", "targetType": "company", "targetName": "Acme Corp"}]}

## User-centric relationships
The user is implicit and NEVER appears in \`entities\`. But the user CAN appear as a target in relationships where someone is connected to the user. For those, use the reserved form:
- {"targetType": "person", "targetName": "user"}

Example: content "Sarah reports to me" →
  entities: [{"type": "person", "name": "Sarah"}]
  relationships: [{"sourceType": "person", "sourceName": "Sarah", "relationship": "reports_to", "targetType": "person", "targetName": "user"}]

## Rules
- Only extract entities and relationships explicitly stated or directly implied.
- Use canonical names (full names, official company names) — Pascal-Case for projects (e.g., "Mobile Launch" not "mobile launch").
- Do NOT put the user in \`entities\`. They are implicit. Refer to them only as the reserved target "user" in relationships.
- If nothing worth extracting, return {"entities": [], "relationships": []}.
- No markdown fences, no commentary — only the raw JSON object.`;

export async function extractGraph(
  text: string,
  userId: string,
  provider: AIProvider,
  providerName: AIProviderName,
  prisma: ExtendedPrismaClient,
  _sourceContext?: { type: string; entityId: string },
): Promise<ExtractionResult> {
  if (text.length < 50) return { entities: [], relationships: [] };

  const model = resolveModel(providerName, "small");
  let fullResponse = "";

  for await (const chunk of provider.chat({
    model,
    messages: [
      {
        role: "user",
        content: `<user_data label="content">\n${text.slice(0, 4000)}\n</user_data>`,
      },
    ],
    system: GRAPH_EXTRACTION_PROMPT,
    temperature: 0.1,
    maxTokens: 1024,
  })) {
    if (chunk.type === "text") fullResponse += chunk.content;
    if (chunk.type === "done") {
      logUsage(prisma, {
        userId,
        provider: providerName,
        model,
        modelTier: "small",
        source: "graph_extraction",
        inputTokens: chunk.usage.input,
        outputTokens: chunk.usage.output,
      }).catch(() => {});
    }
  }

  return parseAndValidate(fullResponse);
}

/** Exported for testing — validates raw LLM output into a safe ExtractionResult */
export function parseAndValidate(raw: string): ExtractionResult {
  let parsed: ExtractionResult;
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return { entities: [], relationships: [] };
  }

  // Validate entities
  const validEntities = (parsed.entities ?? []).filter((e) => {
    if (!e || typeof e.type !== "string" || typeof e.name !== "string") return false;
    if (!VALID_GRAPH_ENTITY_TYPES.has(e.type)) return false;
    if (e.name.length > 200 || e.name.length < 1) return false;
    if (INJECTION_PATTERN.test(e.name)) return false;
    if (TAG_INJECTION_PATTERN.test(e.name)) return false;
    if (e.properties) {
      for (const val of Object.values(e.properties)) {
        if (
          typeof val === "string" &&
          (INJECTION_PATTERN.test(val) || TAG_INJECTION_PATTERN.test(val))
        )
          return false;
      }
    }
    return true;
  });

  // Validate relationships
  const validRelationships = (parsed.relationships ?? []).filter((r) => {
    if (!r || typeof r.relationship !== "string") return false;
    if (!VALID_RELATIONSHIP_TYPES.has(r.relationship)) return false;
    if (typeof r.sourceName !== "string" || typeof r.targetName !== "string") return false;
    if (INJECTION_PATTERN.test(r.sourceName) || INJECTION_PATTERN.test(r.targetName)) return false;
    if (TAG_INJECTION_PATTERN.test(r.sourceName) || TAG_INJECTION_PATTERN.test(r.targetName))
      return false;
    return true;
  });

  return { entities: validEntities, relationships: validRelationships };
}
