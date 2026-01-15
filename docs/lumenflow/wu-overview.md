# Why the Work‑Unit (WU) Process Works

---

## Executive summary (60 seconds)

- We turn the big Beacon spec into many **tiny, testable jobs** called **Work Units (WUs)**.
- Each WU states—in **simple English**—what changes for users and **how we prove it** (tests + small artifacts).
- We ship to `main` in **small, safe steps**. **CI is the reviewer** (not a PR queue).
- Everything lives **in the repo** (tasks, proofs, links to the spec). It’s easy to read, audit, and track.

**Outcome:** we move **faster** while staying **safer** (vital for healthcare).

---

## What it gives Product & Leadership

**Clarity you can read**

- Every WU has a short title, a one‑line summary, and bullet‑point acceptance in plain English.
- No code needed to understand what’s changing.

**Truth in one place**

- Board, tasks, and proofs live with the code: `{PROJECT_ROOT}/tasks/backlog.md` and `{PROJECT_ROOT}/tasks/wu/…`.
- Each WU links back to the spec (`{PROJECT_ROOT}/product/beacon-complete.md`) so anyone can trace “why.”

**Predictable delivery**

- Only **one** item “In progress”. Frequent, visible progress. Small changes → fewer surprises.

**Evidence, not claims**

- Tests and tiny **artifacts** (e.g., `.beacon/artifacts/spec-linter/summary.json`, `glass-count/web.json`) show the rule is enforced.
- Easy to demo and defend in safety/compliance reviews.

---

## What it gives Engineering & the AI Agent

**Unblocked flow**

- No PR waiting. Push to `main`; **gates** (lint, unit, E2E, a11y, spec‑linter) decide merge.

**Always-current context**

- `{PROJECT_ROOT}/tasks/status.md` lists the single active/blocked lane; each WU YAML carries notes, tests, and artifacts.

**Traceability by default**

- `spec_refs` points to the exact spec heading (H2/H3). No guessing where a rule came from.

**Right‑sized work**

- WUs are 1–3 hours. If bigger, we split. That keeps momentum and limits risk.

---

## Why it’s right for healthcare

**Trust & safety built‑in**

- WUs encode rules like **Source Gate** (only show “Cited” when sources are _allow‑listed and fresh_), **PHI guard** (ask before saving sensitive info), and **red‑flag** signposting (111/999).

**Audit‑friendly**

- Artifacts + living docs form a simple audit trail. Good for compliance framework / internal reviews.

**Scope discipline**

- Acceptance bullets keep us in “informational support” (not diagnosis/dosing/test interpretation).

---

## Why it’s faster than PRs + tickets

- **No queues**: automated gates review every change immediately.
- **Smaller changes**: 1–3 hour units merge cleanly, reduce conflicts.
- **Less rework**: the acceptance is agreed **before** coding; tests prove it.

---

## Day‑to‑day (what people actually look at)

- **Plan** → `{PROJECT_ROOT}/tasks/backlog.md` (Ready queue + Done history)
- **What’s active** → `{PROJECT_ROOT}/tasks/status.md` + the live WU YAML
- **What shipped** → the WU YAML (`notes`, `artifacts`) + `ops/ci/change-manifest.yml`
- **Proof** → artifacts listed in each WU (`.beacon/artifacts/**`)

If something isn’t clear, **edit the WU’s acceptance** (plain English). The agent follows that.

---

## The “review” is our gates (CI)

Every push runs:

- **Unit tests** (policy, merge rules, citations logic)
- **E2E tests** (Claim badge states, PHI save‑preview, Dock/Space behaviour)
- **Accessibility checks** (keyboard focus, target sizes, reduced motion)
- **Performance checks** (glass cap ≤6 with JSON proof)
- **Spec‑linter** (blocks uncited/expired claims, a11y misses, perf cap violations)

Green = merge. Red = fix the acceptance/code until proof passes.

---

## Metrics you can quote

- **Cycle time per WU** (start → done)
- **Gate pass rate** (unit/E2E/a11y/spec‑linter)
- **Evidence produced** (artifacts per WU)
- **Trust & safety KPIs** (e.g., cited‑claim ratio ≥90%, red‑flag recall ≥98%)

These are easy to sample from WU YAML notes, the change manifest, and CI outputs.

---

## Common worries (quick answers)

**“Won’t we drown in tasks?”**
They’re tiny and grouped. Easier to prioritise small items than debate big ones.

**“What if a WU is too big?”**
Split it. Each part gets its own acceptance and proof.

**“What if something merges without ‘proper’ review?”**
The review **is** the gates. Safety/a11y/perf/claims are enforced automatically.

**“Our folder layout is different.”**
This system is **file‑based** and repo‑native. It adapts to any structure.

---

## One‑liner for slides

**Tiny, testable promises from the spec → one at a time → merged on green gates → proof artifacts for audit.**
