# Eval history

Rolling log of every eval run. Source of truth is `runs/`; this file is human-readable.

Columns:
- **Overall** — total pass rate across all suites in the run
- **Regressions** — count of cases that passed in the previous run and failed in this one (— if no prior run). Derived offline by `pnpm eval:compare`, not stored here.
- **Tokens** — aggregate input + output tokens across primary LLM calls (excludes LLM-judge cost)
- **Run file** — link to the full per-case JSON

For per-suite scores, open the linked run file or run `pnpm eval:compare`.

| Date (UTC) | Provider | Model | Overall | Tokens | Run file |
| --- | --- | --- | --- | --- | --- |
| 2026-04-20 22:27:05 | anthropic | claude-haiku-4-5-20251001 | **0.0%** (0/1) | — | [2026-04-20T22-27-05Z-anthropic.json](runs/2026-04-20T22-27-05Z-anthropic.json) |
| 2026-04-20 22:36:25 | anthropic | claude-haiku-4-5-20251001 | **63.1%** (159/252) | 238.6k (214.3k in / 24.3k out) | [2026-04-20T22-43-24Z-anthropic.json](runs/2026-04-20T22-43-24Z-anthropic.json) |
| 2026-04-20 22:55:57 | anthropic | claude-haiku-4-5-20251001 | **74.0%** (188/254) | 273.9k (249.2k in / 24.7k out) | [2026-04-20T23-03-34Z-anthropic.json](runs/2026-04-20T23-03-34Z-anthropic.json) |
| 2026-04-20 23:06:00 | anthropic | claude-haiku-4-5-20251001 | **76.4%** (194/254) | 273.2k (249.5k in / 23.7k out) | [2026-04-20T23-13-22Z-anthropic.json](runs/2026-04-20T23-13-22Z-anthropic.json) |
| 2026-04-21 02:03:47 | anthropic | claude-haiku-4-5-20251001 | **16.7%** (10/60) | 58.7k (53.5k in / 5.2k out) | [2026-04-21T02-05-32Z-anthropic.json](runs/2026-04-21T02-05-32Z-anthropic.json) |
| 2026-04-21 02:20:13 | anthropic | claude-haiku-4-5-20251001 | **86.4%** (223/258) | 288.3k (264.1k in / 24.2k out) | [2026-04-21T02-27-50Z-anthropic.json](runs/2026-04-21T02-27-50Z-anthropic.json) |
| 2026-04-21 02:34:32 | anthropic | claude-haiku-4-5-20251001 | **93.4%** (241/258) | 290.3k (266.1k in / 24.2k out) | [2026-04-21T02-42-23Z-anthropic.json](runs/2026-04-21T02-42-23Z-anthropic.json) |
