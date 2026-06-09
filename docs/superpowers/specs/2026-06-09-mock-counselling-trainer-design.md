# Mock Counselling Trainer — Revamp Design

**Date:** 2026-06-09
**Status:** Approved

## Summary

Revamp the bare-MVP student-sim into a two-role **mock counselling training platform**.
An **admin** manages a persona library and assigns mock counselling sessions to
**counsellors**. A counsellor runs the (existing) phase-based, voice-or-text sales
simulation against an LLM-roleplayed student. On session end, an LLM generates a
**rubric-based coaching report** from the transcript, persisted to local JSON files and
visible to both the counsellor (own reports) and the admin (all reports).

## Decisions (locked)

- **Persistence:** JSON file store under `server/data/*.json` (shared source of truth). Login session in `localStorage`.
- **Auth:** dummy. Pre-seeded accounts only (1 admin + 2 counsellors). No real auth/JWT; API is role-trusting (MVP).
- **Personas:** seed library + full admin CRUD + per-assignment prompt override.
- **Rubric:** built-in fixed 6-criterion rubric, scored 1–5 with level labels.
- **Scenario:** situational brief on the single fixed IIM Ranchi × Masai course (`title`, `difficulty`, `situation`, `contextNotes`), embedded in the assignment.
- **Live score:** keep the live satisfaction meter visible during the chat.
- **Styling:** Tailwind CSS, Monexa-inspired (light, airy, soft shadows, rounded-2xl cards, indigo accent, collapsible sidebar).
- **Counsellor flow:** admin-assigned mocks **plus** ad-hoc free practice. Both produce saved reports.

## Engine (kept, refactored)

- 4-phase state machine (Introduction → Course Info → Concerns/Objections → Closing) with heuristic phase advancement (`sessions.js` logic preserved).
- Per-message −10..+10 LLM scoring → running 0–100 satisfaction score → live meter.
- Refactored so the system prompt is composed from **persona + scenario objects** (not hardcoded archetype constants). The seed personas carry the ported archetype prompts.
- Sessions persisted to the store; the server owns the transcript (client no longer ships history).

## Report

On `End Session`, one LLM call over the full transcript produces structured JSON:
- **Overall:** weighted % (0–100) + band (Needs Work / Good / Excellent) + outcome (Converted / Not Converted).
- **Rubric (6 criteria, 1–5 + level + justification):** Rapport & Opening, Needs Discovery, Objection Handling, Product Knowledge & Accuracy, Closing & Next Steps, Communication & Empathy.
- **Phase-by-phase breakdown.**
- **Strengths & improvement areas** with transcript quotes.
- **Annotated transcript + satisfaction-score arc.**

## Architecture

- **Server:** Express + Ollama (`gpt-oss:120b`). New modules: `store.js` (file store), `personas.js`/seed, `prompt.js` (persona-driven prompt builder), `scoring.js`, `report.js`. `index.js` exposes the full REST API.
- **Client:** React 19 + Vite 8 + react-router + Tailwind. Role-based routing, two layout shells, a shared UI kit, admin pages, counsellor pages (incl. revamped chat reusing the existing voice pipeline), and a shared report-detail page.

See `CONTRACT.md` (repo root) for the exact API shapes, data shapes, routes, design tokens, UI-kit component props, and file-ownership map that the parallel build agents implement against.

## Execution

1. **Foundation (serial):** backend + client build config + client spine + stubs for every page/component (build never breaks).
2. **Parallel fan-out (workflow):** UI kit → (barrier) → pages/features, partitioned by file so agents never collide. Each agent gets an explicit goal + acceptance criteria.
3. **Integration & verification (serial):** lint + build + full session→report smoke test on both roles.

## Out of scope (YAGNI for v1)

Real auth/passwords/security, multi-product/course editing, admin-configurable rubrics, in-app user creation, analytics dashboards beyond simple stat cards, mobile-first layouts.
