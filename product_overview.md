# Brett — Product Overview

> **Brett** is a personal AI chief of staff: a desktop + mobile application that acts as a unified command center for tasks, calendar events, communications, and intelligence, with agentic AI workflows at its core.

---

## Purpose

Brett is built for personal use by its creator — not as a commercial product. Every design decision optimizes for depth, power, and personal fit over broad market appeal.

The core premise: a modern knowledge worker's context is scattered across dozens of tools. Brett collapses that surface area into a single intelligent view and then acts on it — the AI does the integration work, and the human focuses on decisions and action.

---

## The Problem Being Solved

The average professional juggles:
- Multiple communication channels (email, Slack, iMessage, etc.)
- Separate task managers and to-do lists
- Calendar apps that show time but offer no intelligence
- Meeting notes tools that capture context but don't surface it
- Ad hoc AI tools that require context to be re-entered every session

The result: the human becomes the integration layer, constantly triaging and context-switching. Brett inverts this.

---

## Core Concepts

### Things

The universal data model. Every item in the system — regardless of type — is a **Thing**. Tasks, events, notes, messages, and AI-generated alerts are all Things.

Every Thing carries three first-class properties:

| Property | Description |
|---|---|
| `source` | Where it came from — Brett itself, a Scout, an integration, a website. This is distinct from type and list, and is treated as meaningful context, not metadata. |
| `type` | What kind of thing it is (task, event, note, alert, etc.) |
| `list` | Where it lives in the organizational hierarchy |

Source provenance is intentionally a first-class concern: knowing that a task was surfaced by a Scout versus entered manually versus imported from email matters for trust, filtering, and attribution throughout the UI.

---

### Scouts

Scouts are **persistent background monitoring agents**. Each Scout watches a data source or topic and surfaces relevant intelligence into Brett's inbox as Things. Think of them as standing queries that run continuously on the user's behalf.

Examples:
- Monitor a company's LinkedIn for job posting changes
- Track a competitor's pricing page for updates
- Watch a news feed for mentions of a specific topic
- Flag calendar invites that have no agenda

Scouts transform Brett from a passive organizer into an active intelligence system.

---

### Inbox Triage

New Things — whether entered manually or surfaced by Scouts — flow into an inbox. Triage is a first-class workflow: the user reviews, acts on, snoozes, or routes each item. This is the primary daily interaction pattern.

---

### Agentic Workflows

Brett uses the Claude API to execute multi-step tasks autonomously. Rather than answering a question, Brett can take action: scheduling a meeting, drafting a reply, researching a topic, or completing a task across integrated tools.

---

## Key Integrations

Integrations are delivered via **MCP (Model Context Protocol)**, a standard that allows Claude to interact with external services in a structured, auditable way.

| Integration | Role |
|---|---|
| **Granola** | AI meeting notes — surfaced via MCP to bring meeting context into Brett's awareness |
| **Calendar** | Events become Things; Brett can reason about scheduling and surface conflicts or gaps |
| **Email / Slack** | Communications flow into the inbox for triage; Brett can draft and send responses |
| **Web** | Scouts can monitor public pages and surface changes as Things |
| **Claude API** | Powers all AI reasoning, summarization, and agentic task execution throughout |

---

## Product Surface

### Desktop App (Electron)
The primary interface. A full-featured command center with a daily view combining tasks, events, and inbox items; Scout management; agentic workflow execution and history.

**Aesthetic direction:** dark glass / premium / editorial — semi-transparent panels over full-bleed wallpaper. Not opaque SaaS chrome.

### Mobile App (Expo / React Native)
A companion to the desktop app optimized for inbox triage and quick capture on the go. Full feature parity is a longer-term goal; the initial focus is inbox review and task management.

### Backend Service (Hono on Railway)
A unified API layer handling data persistence, authentication, and integration orchestration. Postgres is the primary data store. All apps communicate through this service.

---

## Technical Stack (Summary)

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript throughout |
| Desktop | Electron |
| Mobile | Expo (React Native) |
| Backend | Hono on Railway |
| Database | Postgres (Railway) |
| Auth | Better Auth (JWT-based, running inside Hono service) |
| File Storage | Railway Buckets (S3-compatible) |
| Notifications | Firebase Cloud Messaging (FCM) |
| UI | React + shadcn/ui |
| AI / Agentic | Claude API, MCP |
| Dev Tooling | Claude Code, CLAUDE.md |

**Vendor consolidation is a deliberate principle.** For a personal-use system, operational simplicity on a small number of vendors (primarily Railway + Postgres) outweighs marginal gains from specialist services.

---

## Technical Philosophy

- **AI-native, not AI-bolted-on.** Claude's API is the execution engine, not a feature. Every Scout, every agentic action, every inbox summarization runs through it.
- **Source provenance as a first-class concern.** Every Thing knows where it came from. This enables trust signals, filtering, and attribution throughout the UI.
- **Cross-platform by design.** Business logic lives once in shared packages and is consumed by both Electron and Expo.
- **UI-first iteration.** Development starts with the frontend and works toward backend integration, not the other way around.

---

## What Brett Is Not

- Not a commercial product (no monetization, no multi-tenancy, no user acquisition goals)
- Not a replacement for specialized tools — it integrates with them
- Not a general-purpose AI assistant — it is opinionated about the productivity domain
- Not a note-taking app — notes are Things, but long-form content capture is out of scope

---

## Current Status

The monorepo architecture is established. The backend service is in progress. The desktop app UI is being built iteratively with Claude Code. Mobile development follows desktop. MCP integrations and full agentic workflow execution are planned but not yet implemented.

Development sequence: UI-first → backend integration → agentic capability layered on top.