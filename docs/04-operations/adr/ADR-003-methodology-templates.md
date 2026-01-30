# ADR-003: Configurable Methodology Templates

**Status:** Accepted
**Date:** 2026-01-30
**Authors:** Tom @ HellmAI
**Initiative:** INIT-009 (Methodology Configurability)

## Context

LumenFlow was originally designed with strict, opinionated defaults:

- **TDD** (Test-Driven Development) mandatory
- **Hexagonal Architecture** (Ports and Adapters) required
- **90% coverage threshold** enforced

While these are excellent practices, the prescriptive nature limited adoption:

1. **Legacy migrations**: Teams with existing codebases could not gradually adopt LumenFlow
2. **Prototyping**: Research spikes were blocked by coverage requirements
3. **Different domains**: Not all projects benefit equally from hexagonal architecture
4. **Adoption friction**: "All or nothing" approach deterred teams from trying LumenFlow

### Key Finding: What Is Actually Enforced?

| Aspect           | Documentation Says | Actually Enforced By       | Configurable? |
| ---------------- | ------------------ | -------------------------- | ------------- |
| **TDD**          | "mandatory"        | Coverage gate (proxy)      | Yes           |
| **Hexagonal**    | "golden rule"      | Nothing - documentation    | Yes (docs)    |
| **Worktree**     | "non-negotiable"   | Git hooks + command checks | No (core)     |
| **Coverage 90%** | "required"         | `gates.minCoverage`        | Yes           |
| **Gates**        | "must pass"        | `gates.execution.*` config | Mostly        |

**Insight**: TDD and Hexagonal are documentation prescriptive, not code enforced. Worktree discipline is the only truly non-negotiable architectural decision.

## Decision

We introduce **configurable methodology templates** that allow teams to choose their testing and architecture approach while keeping core workflow invariants (worktree discipline, WU lifecycle, lane organization) non-negotiable.

### What Remains Invariant

These are fundamental to LumenFlow and cannot be configured away:

1. **Worktree discipline** - Core to parallel WU isolation
2. **WU lifecycle** (create -> claim -> prep -> done) - Defines the workflow
3. **Lane-based organization** - Enables WIP limits and parallelism
4. **Gates system** - Exists and runs (but what gates run is configurable)

### What Becomes Configurable

These default to strict settings but can be adjusted:

1. **Testing methodology** - `tdd`, `test-after`, or `none`
2. **Architecture guidance** - `hexagonal`, `layered`, or `none`
3. **Coverage posture** - Derived from methodology, with explicit overrides

### Config Schema

```yaml
# .lumenflow.config.yaml
methodology:
  testing: 'tdd' # tdd | test-after | none
  architecture: 'hexagonal' # hexagonal | layered | none
  overrides:
    coverage_threshold: 85 # Override template default
    coverage_mode: 'warn' # block | warn | off
```

### Template Defaults

| Methodology  | Coverage Threshold | Coverage Mode | Tests Required |
| ------------ | ------------------ | ------------- | -------------- |
| `tdd`        | 90%                | block         | true           |
| `test-after` | 70%                | warn          | true           |
| `none`       | 0%                 | off           | false          |

### Single Source of Truth: `resolvePolicy()`

A central resolver produces a **Resolved Policy** used by all consumers:

```
.lumenflow.config.yaml (methodology decisions)
              |
      resolvePolicy(config)
              |
    +---------+---------+
    |                   |
wu:spawn             gates/wu:done
(template assembly)  (enforcement)
```

Both consumers read from the SAME resolved policy. No drift between what agents are told and what is enforced.

### Precedence Rules

1. **CLI flags** (highest) - One-off overrides for specific runs
2. **Explicit gates.\* configuration** - Backwards compatible with existing configs
3. **methodology.overrides** - Team-level tweaks to template defaults
4. **Methodology template defaults** (lowest) - Sensible starting points

## Consequences

### Benefits

1. **Gradual adoption**: Teams can start with relaxed settings and tighten over time
2. **Context-appropriate**: Spike work uses `none`, production uses `tdd`
3. **Backwards compatible**: Existing configs with explicit `gates.*` settings continue to work
4. **Single source of truth**: `resolvePolicy()` prevents drift between prompting and enforcement

### Trade-offs

1. **More configuration surface**: Teams must understand methodology options
2. **Potential misuse**: Teams might disable everything permanently
3. **Documentation complexity**: More options require more documentation

### Mitigations

- Clear documentation on when to use each methodology
- Default to strict (`tdd` + `hexagonal`) so relaxation is intentional
- Test ratchet (separate concern) can prevent regressions regardless of methodology

## Alternatives Considered

### 1. Keep Everything Mandatory

**Rejected**: Limits adoption and forces workarounds. Teams either fully comply or don't use LumenFlow.

### 2. Per-WU Methodology Override

**Considered for future**: Allow individual WUs to override project methodology. Deferred to avoid complexity in v1.

### 3. Methodology as Presets Only

**Rejected**: Presets without override capability don't allow fine-tuning. Teams need both high-level presets and low-level overrides.

## Implementation

- **WU-1259**: Core `resolvePolicy()` implementation
- **WU-1260**: Template infrastructure (`.lumenflow/templates/`)
- **WU-1261**: Gates integration (uses resolved policy)
- **WU-1262**: wu:spawn integration (template assembly)
- **WU-1263**: Documentation (this ADR and public guides)

---

## Technical Details: resolvePolicy() Contract

This section documents the internal contract for `resolvePolicy()` for maintainers and contributors.

### Function Signature

```typescript
function resolvePolicy(config: LumenFlowConfig, options?: ResolvePolicyOptions): ResolvedPolicy;
```

### ResolvedPolicy Interface

```typescript
interface ResolvedPolicy {
  testing: 'tdd' | 'test-after' | 'none';
  architecture: 'hexagonal' | 'layered' | 'none';
  coverage_threshold: number; // 0-100
  coverage_mode: 'block' | 'warn' | 'off';
  tests_required: boolean;
}
```

### Precedence Resolution Algorithm

The function applies configuration in layers from lowest to highest precedence:

```
Layer 1: Template Defaults (based on methodology.testing)
   |
   v
Layer 2: methodology.overrides (explicit user tweaks)
   |
   v
Layer 3: gates.* config (only if explicitly set, for backwards compat)
   |
   v
Layer 4: CLI flags (not in resolvePolicy, handled by command layer)
```

### Explicit vs Default Detection

To maintain backwards compatibility, `resolvePolicy()` distinguishes between:

1. **Explicit gates config**: User deliberately set `gates.minCoverage: 75`
2. **Default gates config**: Schema default of 90% was applied

When `rawConfig` is provided, only EXPLICIT `gates.*` values override methodology:

```typescript
const policy = resolvePolicy(config, { rawConfig: originalYaml });
```

Without `rawConfig`, the function falls back to heuristics:

- If `methodology` is specified, methodology controls unless `gates.*` differs from defaults
- If `methodology` is not specified, `gates.*` controls (legacy mode)

### Consumer Integration

#### Gates (wu:prep, wu:done)

```typescript
import { getConfig, resolvePolicy } from '@lumenflow/core';

const config = getConfig();
const policy = resolvePolicy(config);

// Use policy for gate decisions
if (policy.coverage_mode === 'block' && coverage < policy.coverage_threshold) {
  throw new Error('Coverage below threshold');
}
```

#### wu:spawn (Template Assembly)

```typescript
import { resolvePolicy } from '@lumenflow/core';

const policy = resolvePolicy(config);

// Select template based on methodology
const testingDirective = loadTemplate(`methodology/${policy.testing}-directive.md`);
const archDirective = loadTemplate(`architecture/${policy.architecture}-directive.md`);

// Include enforcement info in prompt
const enforcementSection = `
## Enforcement
- Coverage: ${policy.coverage_threshold}% (${policy.coverage_mode})
- Tests required: ${policy.tests_required ? 'Yes' : 'No'}
`;
```

### Testing resolvePolicy()

Key test scenarios:

1. **Default behavior**: No methodology config returns TDD defaults
2. **Methodology selection**: Different methodologies return correct defaults
3. **Override application**: `methodology.overrides` correctly overrides template
4. **Backwards compatibility**: Existing `gates.minCoverage` respected when no methodology
5. **Explicit detection**: With `rawConfig`, only explicit gates values override

See `packages/@lumenflow/core/src/__tests__/resolve-policy.test.ts` for comprehensive tests.

### Error Handling

- Invalid methodology values are caught by Zod schema validation
- Invalid override values (e.g., coverage > 100) are rejected
- Missing config sections use sensible defaults (TDD + Hexagonal)

---

## References

- [Configuration Reference](/reference/config) - Full config documentation
- [Choosing Your Methodology](/guides/choosing-methodology) - Public guide
- [resolve-policy.ts](../../packages/@lumenflow/core/src/resolve-policy.ts) - Implementation
- INIT-009 Work Units: WU-1259, WU-1260, WU-1261, WU-1262, WU-1263
