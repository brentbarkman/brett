# Structured JSON Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prompt-hint JSON enforcement with native schema-constrained decoding in the AI provider layer and scout runner.

**Architecture:** Expand `ChatParams.responseFormat` to support a `json_schema` variant with a name and schema. Each provider adapter maps it to its native API (Anthropic `output_config`, OpenAI `json_schema` response format, Google falls back to `responseMimeType`). Scout runner defines two schemas and passes them to LLM calls.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk ^0.80.0`, `openai ^6.32.0`, `@google/generative-ai ^0.24.1`

---

### Task 1: Expand ChatParams responseFormat type

**Files:**
- Modify: `packages/ai/src/providers/types.ts:27-28`

- [ ] **Step 1: Update the responseFormat type**

Change line 28 from:
```typescript
/** Request JSON output from the model */
responseFormat?: { type: "json_object" };
```

To:
```typescript
/** Request JSON output from the model.
 *  - "json_object": hint-only, no schema enforcement
 *  - "json_schema": schema-constrained decoding (Anthropic/OpenAI enforce, Google falls back to hint)
 */
responseFormat?:
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: Record<string, unknown> };
```

The `name` field is required by OpenAI's API. Anthropic and Google ignore it.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS (union is backward compatible — all existing `{ type: "json_object" }` callers still match)

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/providers/types.ts
git commit -m "feat: expand ChatParams.responseFormat to support json_schema"
```

---

### Task 2: Anthropic provider — map json_schema to output_config

**Files:**
- Modify: `packages/ai/src/providers/anthropic.ts:82-106`

- [ ] **Step 1: Update the chat method**

In the `chat` method, replace the current `responseFormat` handling (lines 90-105) with logic that handles both variants:

```typescript
if (params.system) {
  let systemText = params.system;

  if (params.responseFormat?.type === "json_schema") {
    // Schema-constrained: use native output_config (no text hint needed)
    (requestParams as Record<string, unknown>).output_config = {
      format: { type: "json_schema", schema: params.responseFormat.schema },
    };
  } else if (params.responseFormat?.type === "json_object") {
    // Hint-only fallback
    systemText += "\n\nYou must respond with valid JSON only. No other text.";
  }

  // Cache control: if tools present, tool-level cache covers system+tools.
  // If no tools, cache system prompt directly.
  if (!params.tools?.length) {
    requestParams.system = [
      { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
    ];
  } else {
    requestParams.system = systemText;
  }
}
```

Note: Using `(requestParams as Record<string, unknown>)` for `output_config` since the SDK types may not expose it directly on the streaming params type. The API accepts it regardless.

- [ ] **Step 2: Handle json_schema when no system prompt**

Add after the system block (before temperature):
```typescript
if (!params.system && params.responseFormat?.type === "json_schema") {
  (requestParams as Record<string, unknown>).output_config = {
    format: { type: "json_schema", schema: params.responseFormat.schema },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/providers/anthropic.ts
git commit -m "feat: Anthropic provider maps json_schema to output_config"
```

---

### Task 3: OpenAI provider — map json_schema to native structured output

**Files:**
- Modify: `packages/ai/src/providers/openai.ts:99-101`

- [ ] **Step 1: Update the responseFormat mapping**

Replace lines 99-101:
```typescript
if (params.responseFormat?.type === "json_object") {
  requestParams.response_format = { type: "json_object" };
}
```

With:
```typescript
if (params.responseFormat?.type === "json_schema") {
  requestParams.response_format = {
    type: "json_schema",
    json_schema: {
      name: params.responseFormat.name,
      strict: true,
      schema: params.responseFormat.schema,
    },
  };
} else if (params.responseFormat?.type === "json_object") {
  requestParams.response_format = { type: "json_object" };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/providers/openai.ts
git commit -m "feat: OpenAI provider maps json_schema to native structured output"
```

---

### Task 4: Google provider — fall back to responseMimeType for json_schema

**Files:**
- Modify: `packages/ai/src/providers/google.ts:147-149`

- [ ] **Step 1: Update the responseFormat mapping**

Replace lines 147-149:
```typescript
if (params.responseFormat?.type === "json_object") {
  generationConfig.responseMimeType = "application/json";
}
```

With:
```typescript
if (params.responseFormat?.type === "json_schema" || params.responseFormat?.type === "json_object") {
  generationConfig.responseMimeType = "application/json";
}
```

Google's `Schema` type is incompatible with standard JSON Schema (`additionalProperties` not supported), so both variants use the same `responseMimeType` path. The prompt text hints still guide structure for Google users.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/providers/google.ts
git commit -m "feat: Google provider handles json_schema as responseMimeType fallback"
```

---

### Task 5: Scout runner — define schemas and wire them into LLM calls

**Files:**
- Modify: `apps/api/src/lib/scout-runner.ts`

- [ ] **Step 1: Add schema constants near the top of the file (after VALID_FINDING_TYPES)**

```typescript
/** JSON schema for query generation — forces structured object output */
const QUERY_GENERATION_SCHEMA = {
  type: "object" as const,
  properties: {
    queries: {
      type: "array" as const,
      items: { type: "string" as const },
    },
  },
  required: ["queries"],
  additionalProperties: false,
};

/** JSON schema for judgment — forces structured findings + cadence output */
const JUDGMENT_SCHEMA = {
  type: "object" as const,
  properties: {
    findings: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          type: { type: "string" as const, enum: ["insight", "article", "task"] },
          title: { type: "string" as const },
          description: { type: "string" as const },
          sourceUrl: { type: "string" as const },
          sourceName: { type: "string" as const },
          relevanceScore: { type: "number" as const },
          reasoning: { type: "string" as const },
        },
        required: ["type", "title", "description", "sourceUrl", "sourceName", "relevanceScore", "reasoning"],
        additionalProperties: false,
      },
    },
    cadenceRecommendation: { type: "string" as const, enum: ["elevate", "maintain", "relax"] },
    cadenceReason: { type: "string" as const },
    reasoning: { type: "string" as const },
  },
  required: ["findings", "cadenceRecommendation", "cadenceReason", "reasoning"],
  additionalProperties: false,
};
```

- [ ] **Step 2: Update buildSearchQueries — use json_schema and fix parse logic**

In `buildSearchQueries`:

a) Remove the last line of the system message — change:
```
`- Avoid queries that would return results listed in <recent_findings>\n\n` +
`Output a JSON array of strings. Nothing else.`;
```
To:
```
`- Avoid queries that would return results listed in <recent_findings>`;
```

b) Change the `responseFormat` in the `collectChatResponse` call from:
```typescript
responseFormat: { type: "json_object" },
```
To:
```typescript
responseFormat: { type: "json_schema", name: "search_queries", schema: QUERY_GENERATION_SCHEMA },
```

c) Update the parse logic from:
```typescript
const parsed = JSON.parse(extractJSON(text));
if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((q) => typeof q === "string")) {
  return { queries: parsed.slice(0, 3), tokensUsed };
}
```
To:
```typescript
const parsed = JSON.parse(extractJSON(text));
const queries = Array.isArray(parsed.queries) ? parsed.queries : Array.isArray(parsed) ? parsed : [];
if (queries.length > 0 && queries.every((q: unknown) => typeof q === "string")) {
  return { queries: queries.slice(0, 3) as string[], tokensUsed };
}
```

This handles both the new `{ queries: [...] }` shape and falls back to raw array (for Google or if schema enforcement is absent).

- [ ] **Step 3: Update judgeResults — use json_schema and trim prompt**

In `judgeResults`:

a) Remove the JSON template from the end of the system message — change:
```
Return a JSON object:
{"findings": [{"type": "...", "title": "...", "description": "what this means for the goal (2-3 sentences)", "sourceUrl": "...", "sourceName": "domain.com", "relevanceScore": 0.0-1.0, "reasoning": "..."}], "cadenceRecommendation": "...", "cadenceReason": "...", "reasoning": "overall assessment"}`;
```
To:
```
Evaluate each result and return your assessment.`;
```

b) Change the `responseFormat` in the `collectChatResponse` call from:
```typescript
responseFormat: { type: "json_object" },
```
To:
```typescript
responseFormat: { type: "json_schema", name: "judgment", schema: JUDGMENT_SCHEMA },
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/scout-runner.ts
git commit -m "feat: scout runner uses schema-constrained JSON for LLM calls"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Build the full project**

Run: `cd /Users/brentbarkman/code/brett && pnpm build`
Expected: PASS

- [ ] **Step 2: Run tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test`
Expected: PASS (no test changes needed — schemas are additive)

- [ ] **Step 3: Final commit if any fixes needed**
