# Documentation Index

Welcome to the LumenFlow documentation. Organized by **concern and audience** following arc42 + C4 model best practices.

---

## Quick Start by Role

| Role                 | Start Here                       | Key Documents                          |
| -------------------- | -------------------------------- | -------------------------------------- |
| **Product/Business** | [01-product/](01-product/)       | Vision, product lines, tiers           |
| **Engineering**      | [02-technical/](02-technical/)   | Architecture, packages, implementation |
| **Operations**       | [04-operations/](04-operations/) | Tasks, WU management                   |
| **Distribution**     | [plans/](plans/)                 | Distribution plan, npm publishing      |

---

## Documentation Structure

### [01-product/](01-product/) - WHAT We're Building

Product vision, specifications, and go-to-market.

**Key Files:**

- [vision.md](01-product/vision.md) - Product vision statement
- [product-lines.md](01-product/product-lines.md) - Distribution channels, tiers, customer journeys

---

### [02-technical/](02-technical/) - HOW It's Built

Technical architecture, package documentation, implementation guides.

**Subdirectories:**

- [architecture/](02-technical/architecture/) - System design, package relationships

**Packages:**

| Package                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `@lumenflow/core`        | Core WU types, validation, configuration |
| `@lumenflow/cli`         | 30+ CLI commands (wu-_, mem-_, gates)    |
| `@lumenflow/memory`      | Session tracking, context recovery       |
| `@lumenflow/agent`       | Agent coordination primitives            |
| `@lumenflow/metrics`     | Flow metrics and reporting               |
| `@lumenflow/initiatives` | Multi-WU project tracking                |
| `@lumenflow/shims`       | Git safety shims                         |

---

### [04-operations/](04-operations/) - HOW We Work

Task management, WU tracking, and operational procedures.

**Subdirectories:**

- [tasks/](04-operations/tasks/) - WU management (backlog, status, WU YAML files)

**Key Files:**

- [tasks/backlog.md](04-operations/tasks/backlog.md) - Master backlog (single source of truth)
- [tasks/status.md](04-operations/tasks/status.md) - Current WU status

---

### [05-business/](05-business/) - Strategic Direction

Go-to-market strategy, pricing, metrics.

---

### [plans/](plans/) - Execution Plans

Active plans for major initiatives.

**Key Files:**

- [distribution-dogfooding.md](plans/distribution-dogfooding.md) - npm publishing and dogfooding plan

---

### [lumenflow/](lumenflow/) - Framework Reference

LumenFlow methodology documentation.

---

### [templates/](templates/) - Templates

Reusable templates for WUs, PRs, etc.

---

## Documentation Principles

1. **Single Source of Truth** - Each concept documented once, referenced everywhere
2. **Audience-Driven** - Organized by who needs it, not what it describes
3. **Self-Contained** - Each document usable standalone with clear cross-references
4. **Living Documentation** - Updated as part of WU Definition of Done

---

## Related Documentation

- **Root README:** See [/README.md](../README.md) for quickstart and tech stack overview
- **Apps:** See [/apps/](../apps/) for GitHub App documentation

---

**Last Updated:** 2026-01-18
