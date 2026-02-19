# Work Classification Signals

**WU-1899** | Last updated: 2026-02-19

## Overview

The work classifier determines the domain of a Work Unit (UI, backend, docs, infra, or mixed) using multiple weighted signals rather than hardcoded lane name checks. This enables accurate skill suggestions and test methodology hints regardless of which lane a WU belongs to.

## Problem

Previously, `wu:brief` skill suggestions used hardcoded checks like `laneParent === 'Experience'` to detect UI work. This missed UI work in non-Experience lanes (e.g., a Framework lane WU that modifies CSS files or component directories).

## Signal Architecture

The classifier examines four signal sources, each with a fixed weight:

| Signal Source | Weight | Description                                  |
| ------------- | ------ | -------------------------------------------- |
| `code_paths`  | 1.0    | File path glob pattern matching (strongest)  |
| `lane`        | 0.6    | Lane parent/sublane name hints               |
| `type`        | 0.3    | WU type field (e.g., `documentation`)        |
| `description` | 0.2    | Keyword matching in WU description (weakest) |

### Confidence Calculation

- Confidence = max(matched signal weights for the winning domain), not sum
- Domain is only assigned when confidence >= 0.3 (the threshold)
- `testMethodologyHint: 'smoke-test'` is only set when UI domain confidence >= 0.5

### Domain Detection

The classifier recognizes five domains:

| Domain    | Meaning                                        |
| --------- | ---------------------------------------------- |
| `ui`      | Frontend/visual work (CSS, components, pages)  |
| `backend` | Server-side or library code (default fallback) |
| `docs`    | Documentation changes                          |
| `infra`   | Infrastructure/DevOps changes                  |
| `mixed`   | Multiple domains detected via code_paths       |

## Built-in Default Patterns

### UI Detection (code_paths)

The following patterns are matched against `code_paths` without any configuration:

- CSS/SCSS/LESS files: `**/*.css`, `**/*.scss`, `**/*.less`
- Module CSS: `**/*.module.css`, `**/*.module.scss`
- Styled components: `**/*.styled.ts`, `**/*.styled.tsx`
- Component directories: `**/components/**`
- Page directories: `**/pages/**`
- App router files: `**/app/**/page.tsx`, `**/app/**/layout.tsx` (and .ts/.jsx/.js variants)

### UI Detection (lane hints)

Lane parent names matched case-insensitively: Experience, Frontend, UI, Design.

### Docs Detection

- Code paths: `docs/**`, `**/*.md`, `**/*.mdx`, `README*`, `CHANGELOG*`
- Lane hints: Content, Documentation, Docs
- WU type: `documentation`

### Infra Detection

- Code paths: `.github/**`, `Dockerfile*`, `docker-compose*`, `**/terraform/**`, `**/k8s/**`
- Lane hints: Operations, Infrastructure, DevOps, Platform

## Configuration

Extend defaults via `methodology.work_classification` in `.lumenflow.config.yaml`:

```yaml
methodology:
  work_classification:
    ui:
      code_path_patterns:
        - 'src/widgets/*.tsx'
        - 'src/views/**'
      lane_hints:
        - 'Design'
        - 'Visual'
```

Custom values **extend** defaults -- they do not replace them. All built-in patterns continue to work alongside custom additions.

## Return Value

`classifyWork(doc, config?)` returns:

```typescript
interface WorkClassification {
  domain: 'ui' | 'backend' | 'docs' | 'infra' | 'mixed';
  confidence: number; // 0-1, max signal weight
  signals: WorkSignal[]; // Individual matched signals
  capabilities: string[]; // Abstract capability tags
  testMethodologyHint?: string; // e.g., 'smoke-test'
}
```

### Capabilities (Vendor-Agnostic)

The classifier returns abstract capability tags, not client-specific skill names:

| Domain    | Capabilities                                   |
| --------- | ---------------------------------------------- |
| `ui`      | `ui-design-awareness`, `component-reuse-check` |
| `docs`    | `documentation-structure`, `link-validation`   |
| `infra`   | `infrastructure-review`, `security-check`      |
| `mixed`   | `cross-domain-awareness`                       |
| `backend` | (none)                                         |

## Usage

```typescript
import { classifyWork, WORK_DOMAINS } from '@lumenflow/core';

const result = classifyWork({
  code_paths: ['src/components/Button.tsx'],
  lane: 'Framework: Core',
  type: 'feature',
  description: 'Add accessible button component',
});

// result.domain === 'ui'
// result.confidence === 1.0 (code_paths weight)
// result.testMethodologyHint === 'smoke-test'
// result.capabilities === ['ui-design-awareness', 'component-reuse-check']
```

## Brief Integration (WU-1900)

The work classifier is wired into `wu:brief` generation at three points:

### 1. Capability-to-Skill Mapping

Abstract capabilities are mapped to client-specific skills via `capabilities_map` in client config:

```yaml
agents:
  clients:
    claude-code:
      capabilities_map:
        ui-design-awareness: frontend-design
        component-reuse-check: library-first
```

When a WU's `code_paths` trigger the `ui` domain, the classifier returns capabilities like `ui-design-awareness`. These are resolved through the client's `capabilities_map` to produce skill suggestions like `frontend-design` in the brief's Soft Policy section.

This is vendor-agnostic: the classifier returns abstract capabilities; each client maps them to its own skill names.

### 2. Test Guidance

For `bug` type WUs classified as UI domain, `generatePolicyBasedTestGuidance` returns smoke-test guidance instead of full TDD. This fixes the bug where `SMOKE_TEST_TYPES` was unreachable through normal WU types.

### 3. Conditional TDD CHECKPOINT

The constraints block's TDD CHECKPOINT (constraint #1) is omitted when:
- Work is classified as UI domain (smoke-test methodology)
- Policy methodology is `none`

Remaining constraints are renumbered dynamically.

### 4. Design Context Section

A new `## Design Context` section is added to the brief for UI-classified work. It includes:
- Pattern check guidance (check for existing components before creating new ones)
- Viewport verification guidance (test across breakpoints)
- Accessibility requirements
- Codebase exploration hints

This section is vendor-agnostic -- no `/skill` syntax or client-specific skill names.

## Related

- `packages/@lumenflow/core/src/work-classifier.ts` - Implementation
- `packages/@lumenflow/core/src/path-classifiers.ts` - Predecessor (docs-only detection)
- `packages/@lumenflow/core/src/wu-spawn-skills.ts` - Consumer (skill suggestions)
- `packages/@lumenflow/core/src/wu-spawn.ts` - Consumer (test guidance, design context, constraints)
