# LumenFlow Vision

LumenFlow is an AI-native workflow framework that enables software teams to deliver right-sized, well-scoped work through structured Work Units (WUs), lane-based parallelism, quality gates, and agent coordination.

- **Who:** Software teams using AI agents (Claude, GPT, etc.) for development
- **What:** Workflow infrastructure — WU specs, lane isolation, quality gates, memory layer, multi-agent coordination
- **How:** CLI tools for local development, GitHub App for team enforcement, GitHub Actions for CI integration
- **Guardrails:** WIP limits, gate enforcement, worktree isolation, Definition of Done validation
- **North stars:** Every WU delivers shippable value; agents complete work reliably; teams maintain flow

---

## Core Principles

1. **WUs Are Specs, Not Code** — Work Units define the contract; implementation follows the spec
2. **Lanes Enable Parallelism** — Isolated domains allow concurrent work without conflicts
3. **Gates Ensure Quality** — Format, lint, typecheck, test must pass before completion
4. **Memory Enables Recovery** — Context survives session boundaries and agent handoffs
5. **Backlog Is Law** — All work tracked in backlog; nothing happens outside the system

---

## Product Lines

LumenFlow is distributed through two independent channels:

| Product | Distribution | Audience | Revenue Model |
|---------|--------------|----------|---------------|
| **@lumenflow/cli** | Private npm | Power users, Pro tier | npm org membership |
| **GitHub App** | GitHub Marketplace | Teams | Tiered subscription |

Both channels deliver LumenFlow value. Neither requires the other, but together they provide complete enforcement.

See [product-lines.md](product-lines.md) for detailed architecture and customer journeys.

---

## Value Proposition

**For AI-assisted development teams:**

Without LumenFlow:
- Agents wander, lose context, produce inconsistent work
- No structure for parallel work; agents block each other
- Quality varies; bugs ship to main
- Context lost on session boundaries

With LumenFlow:
- WU specs scope work to shippable increments
- Lanes enable safe parallelism
- Gates enforce consistent quality
- Memory layer preserves context across sessions

---

## Strategic Position

LumenFlow occupies the "AI workflow infrastructure" layer:

```
┌─────────────────────────────────────────────┐
│           AI Agents (Claude, GPT)           │
├─────────────────────────────────────────────┤
│         LumenFlow (workflow layer)          │  ← We are here
├─────────────────────────────────────────────┤
│      Git, CI/CD, Cloud Infrastructure       │
└─────────────────────────────────────────────┘
```

We don't build AI agents. We make them reliable.

---

**Last Updated:** 2026-01-18
