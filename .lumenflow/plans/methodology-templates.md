# Plan: LumenFlow Prescriptiveness Audit & Configurability Enhancement

## Problem Statement

LumenFlow is currently **too prescriptive** for external consumers. While opinionated defaults are good, mandating specific practices without opt-out mechanisms limits adoption.

## Key Finding: Actual Enforcement vs Documentation

| Aspect           | Documentation Says                   | Actually Enforced By                 | Configurable?       |
| ---------------- | ------------------------------------ | ------------------------------------ | ------------------- |
| **TDD**          | "mandatory" in rules/tdd-workflow.md | Coverage gate only (proxy)           | ✅ YES              |
| **Hexagonal**    | ADR-001 "golden rule"                | Nothing - just documentation         | ✅ YES (docs only)  |
| **Worktree**     | "non-negotiable" constraint          | Git hooks + command validation       | ❌ NO (fundamental) |
| **Coverage 90%** | Default threshold                    | `gates.execution.coverage.threshold` | ✅ YES              |
| **Lane format**  | require_parent: true                 | Config validation                    | ✅ YES              |
| **Gates**        | 13 gates run by default              | `gates.execution.*` config           | ✅ MOSTLY           |

**Insight**: TDD and Hex are **documentation prescriptive**, not **code enforced**. Gates are **highly configurable**. Worktree is the only truly non-negotiable architectural decision.

---

## Template File Structure (Vendor-Agnostic)

```
.lumenflow/
├── templates/
│   ├── manifest.yaml                # Assembly order
│   └── spawn-prompt/
│       ├── methodology/
│       │   ├── tdd-directive.md     # TDD-specific guidance
│       │   ├── test-after-directive.md
│       │   └── none-directive.md
│       ├── architecture/
│       │   ├── hexagonal-directive.md
│       │   ├── layered-directive.md
│       │   └── none-directive.md
│       ├── skills-selection.md      # Generic "check your tool's skills"
│       └── constraints.md           # Always included
│
├── templates.claude/                # Claude-specific overrides
│   └── spawn-prompt/
│       └── skills-selection.md      # "Load via /skill <name>"
│
└── templates.cursor/                # Cursor-specific overrides
    └── spawn-prompt/
        └── skills-selection.md      # "Use @rules reference"
```

---

## Related Work / Sequencing

Three related but distinct concerns:

- **Template extraction (WU-1253)**: Move hardcoded prompt strings into `.lumenflow/templates/` (infrastructure).
- **Methodology configurability (INIT-009)**: Allow teams to choose testing/architecture methodology via config.
- **Test ratchet (future WU)**: A non-negotiable quality constraint to prevent regressions.

Recommendation:

- Land **WU-1253** (template extraction) first as foundation
- Build **methodology configurability** on top of the template infrastructure
- **Test ratchet** is orthogonal - applies regardless of methodology choice

---

## Config Schema (v1)

```yaml
# .lumenflow.config.yaml
methodology:
  testing: 'tdd' # tdd | test-after | none
  architecture: 'hexagonal' # hexagonal | layered | none

  # Optional overrides (tweak template defaults)
  overrides:
    coverage_threshold: 85 # Override template default (e.g. TDD default 90)
    coverage_mode: 'warn' # block | warn | off
```

### Template Defaults by Testing Methodology

| Methodology  | Prompt stance                            | Tests gate          | Coverage threshold | Coverage mode |
| ------------ | ---------------------------------------- | ------------------- | ------------------ | ------------- |
| `tdd`        | test-first, RED→GREEN→REFACTOR           | required (block)    | 90%                | block         |
| `test-after` | impl-first ok; tests before done         | required (block)    | 70%                | warn          |
| `none`       | minimal guidance (still recommend tests) | non-blocking (warn) | 0%                 | off           |

---

## wu:spawn Assembly Logic

```typescript
// Pseudocode
function assembleSpawnPrompt(wuId: string, config: Config, client: string) {
  const policy = resolvePolicy(config);

  // 1. Load base templates
  const templates = loadTemplates('.lumenflow/templates/');

  // 2. Select methodology templates based on policy
  const methodologyTemplate = templates[`methodology/${policy.testing}-directive.md`];
  const architectureTemplate = templates[`architecture/${policy.architecture}-directive.md`];

  // 3. Merge client-specific overrides
  const clientOverrides = loadTemplates(`.lumenflow/templates.${client}/`);

  // 4. Assemble in manifest order + token replacement
  return assemble(manifest, { methodologyTemplate, architectureTemplate, ...clientOverrides });
}
```

---

## Verification

After implementation:

1. ✅ Existing users see no change (defaults remain strict/recommended)
2. ✅ Consumers can select methodology to change BOTH prompts and enforcement defaults
3. ✅ Worktree discipline remains non-negotiable
4. ✅ Gates remain highly configurable; explicit `gates.*` overrides still work
5. ✅ `wu:spawn` output stays consistent with the resolved gate plan
