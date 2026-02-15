# LumenFlow Manifesto

**Purpose:** LumenFlow is our vendor-agnostic, stack-agnostic delivery methodology for AI-augmented teams. It combines ports-first engineering, test-driven development, and hexagonal architecture with a lane-based flow system that keeps work visible, parallel, and humane.

## Why LumenFlow Exists

1. **Clarity over chaos** – Every Work Unit (WU) has an explicit state, owner, and outcome. We remove ambiguity so people and agents can execute with confidence.
2. **AI as a first-class collaborator** – We build instructions, ports, and tests that let AI agents contribute safely and autonomously.
3. **Focus without bottlenecks** – Lane-based WIP keeps individual streams calm while still letting multidisciplinary teams move together.
4. **Improvement is continuous** – Research spikes, prompt evaluations, and retros are built into the framework, not bolted on.

## Core Commitments

| Commitment            | What it Means in Practice                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| **Backlog is law**    | Approved WUs are ready for autonomous execution. No scope appears mid-flight.                           |
| **Ports before code** | Interfaces describe the problem before any adapter or UI is designed.                                   |
| **Tests unlock code** | Failing tests precede implementation. Code ships only when gates are green.                             |
| **One WU per lane**   | Each lane (`Experience`, `Core Systems`, `Intelligence`, `Operations`, `Discovery`) runs one active WU. |
| **Explicit states**   | `ready → in_progress → blocked/waiting → done`. Blockers are logged, not hidden.                        |
| **Transparency wins** | Documentation, manifests, and change logs are updated before closing a WU.                              |

## Pillars

- **AI-Augmented Craft** – Treat AI as a teammate. Provide structured prompts, tool access, and evaluation loops.
- **Hexagonal Boundaries** – Keep business logic pure (`@{PROJECT_NAME}/application`), ports explicit, and adapters isolated.
- **Evidence-Driven Delivery** – Use MCP tooling, research spikes, and comparative tests to justify decisions.
- **Accessible Outcomes** – From code to copy, everything should be understandable by the intended audience.
- **Shared Ownership** – Humans and agents reference the same sources of truth: backlog, docs, telemetry.

## Flow at a Glance

```
Backlog (ready)
      ↓ lane capacity free?
Lane board (one WU per lane)
      ↓ implement with TDD
waiting (gates + reviews)
      ↓ ship & document
done (DoD met)
```

Blocked WUs move to `blocked`, capture the dependency, and free their lane. Discovery WUs produce artefacts that seed future implementation WUs.

## Promises to Stakeholders

1. **Predictable throughput** – LumenFlow’s WIP discipline prevents surprise pile-ups.
2. **Traceable decisions** – Every change links back to a WU, port, test, or research note.
3. **Accessible sharing** – Deliverables are structured so partners can adopt the framework whole.
4. **Evolving playbook** – The manifesto stays high-level; tactical guidance lives in the playbook and grows with practice.

LumenFlow is open by default. Share it, adapt it, and contribute improvements back. The brighter the system, the easier it is for humans and AI to build responsibly together.

---

## Version History

### v2.0 (October 2025) - Self-Improvement Initiative

LumenFlow used itself to implement 8 major enhancements: automated validation (WU-400), Git hooks (WU-401), DORA/SPACE telemetry (WU-402), SBOM security (WU-403), prompt testing rigor (WU-404), worktree utilities (WU-405), backlog lifecycle (WU-406), and CODEOWNERS governance (WU-407).

**Key improvements:**

- Rules transformed from documentation to enforcement
- DORA metrics for continuous improvement
- Compliance-ready traceability
- Intelligence lane testing rigor

**Grade evolution:** A- → A+

See: [../lumenflow/lumenflow-evolution.md](../lumenflow/lumenflow-evolution.md) for full context and decision rationale.
