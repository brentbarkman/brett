# Structured JSON Output for Scout LLM Calls

## Goal

Replace prompt-hint JSON enforcement with native schema-constrained decoding across all three AI providers. Eliminates parse failures and wasted output tokens from prose wrapping.

## Background

Scout execution makes two LLM calls per run: query generation (small model) and judgment (small or medium model). Both request JSON output, but enforcement is weak:

- **Anthropic**: Appends "You must respond with valid JSON only" to system message — a soft hint
- **OpenAI**: Uses `response_format: { type: "json_object" }` — forces valid JSON but no schema
- **Google**: Uses `responseMimeType: "application/json"` — forces valid JSON but no schema

All three providers now support schema-constrained output that guarantees structural compliance via constrained decoding. The model literally cannot produce tokens that violate the schema.

## Design

### ChatParams Type Change

Expand `responseFormat` in `packages/ai/src/providers/types.ts`:

```typescript
responseFormat?:
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: Record<string, unknown> }
```

The `name` field is required by OpenAI's API. Anthropic and Google ignore it — it exists in the shared type solely for OpenAI compatibility. Backward compatible — existing `json_object` callers unchanged.

### Provider Mapping

**Anthropic** (`packages/ai/src/providers/anthropic.ts`):
- `json_object` → keep existing text hint behavior (unchanged)
- `json_schema` → use `output_config: { format: { type: "json_schema", schema } }` on the request. Remove the text hint for this path. SDK `^0.80.0` supports `output_config` on `MessageCreateParams` (confirmed in installed types).

**OpenAI** (`packages/ai/src/providers/openai.ts`):
- `json_object` → keep existing behavior (unchanged)
- `json_schema` → use `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`

**Google** (`packages/ai/src/providers/google.ts`):
- `json_object` → keep existing behavior (unchanged)
- `json_schema` → Google's SDK uses `responseSchema` (not `responseJsonSchema`) and expects their own `Schema` type, not raw JSON Schema. Fields like `additionalProperties` are not part of Google's `Schema` type. Rather than building a `jsonSchemaToGoogleSchema()` converter for marginal benefit, **Google falls back to the plain `responseMimeType: "application/json"` path** (same as `json_object`). The schema enforcement comes from Anthropic and OpenAI; Google relies on the existing prompt hints + `extractJSON()` fallback. This is an acceptable tradeoff — Google's guarantee is weaker even with `responseSchema`.

### Scout Runner Schemas

**Query generation** (`buildSearchQueries`):
```json
{
  "type": "object",
  "properties": {
    "queries": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["queries"],
  "additionalProperties": false
}
```

Note: Wrapping in an object because Anthropic/OpenAI strict mode requires the top-level type to be `object`, not `array`.

**Important**: The parse logic in `buildSearchQueries` must change from `Array.isArray(parsed)` to reading `parsed.queries`, since the schema wraps the array in an object.

**Judgment** (`judgeResults`):
```json
{
  "type": "object",
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["insight", "article", "task"] },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "sourceUrl": { "type": "string" },
          "sourceName": { "type": "string" },
          "relevanceScore": { "type": "number" },
          "reasoning": { "type": "string" }
        },
        "required": ["type", "title", "description", "sourceUrl", "sourceName", "relevanceScore", "reasoning"],
        "additionalProperties": false
      }
    },
    "cadenceRecommendation": { "type": "string", "enum": ["elevate", "maintain", "relax"] },
    "cadenceReason": { "type": "string" },
    "reasoning": { "type": "string" }
  },
  "required": ["findings", "cadenceRecommendation", "cadenceReason", "reasoning"],
  "additionalProperties": false
}
```

### Prompt Changes

When using `json_schema` response format:
- Remove "Output a JSON array of strings. Nothing else." from query generation prompt (the schema enforces this)
- Remove "Return a JSON object: {..." from judgment prompt (the schema enforces this)
- Keep the field descriptions and scoring guide — those inform *values*, not structure

### What Stays

- `extractJSON()` — kept as fallback for Google and for any non-schema callers
- `json_object` type — still valid for Brett chat and other callers that don't need schema enforcement
- Post-parse validation in scout runner — belt-and-suspenders, cheap to keep
- Anthropic cache control — unrelated, stays as-is

### SDK Versions

- `@anthropic-ai/sdk` `^0.80.0` — `output_config` supported (confirmed in installed types)
- `openai` `^6.32.0` — `json_schema` response format supported
- `@google/generative-ai` `^0.24.1` — no changes needed (falls back to `responseMimeType` only)

## Files Changed

- `packages/ai/src/providers/types.ts` — expand `responseFormat` type
- `packages/ai/src/providers/anthropic.ts` — add `json_schema` → `output_config` mapping
- `packages/ai/src/providers/openai.ts` — add `json_schema` → native mapping
- `packages/ai/src/providers/google.ts` — add `json_schema` → `responseMimeType` fallback (same as `json_object`)
- `apps/api/src/lib/scout-runner.ts` — define schemas, pass to `collectChatResponse`, update prompts, update parse logic

## Not In Scope

- No UI changes
- No changes to Brett conversational chat
- No changes to other AI skills (create_scout, list_scouts, etc.)
- No new dependencies
