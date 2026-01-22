---
name: code-quality
description: Shared patterns for SOLID/DRY code review, hexagonal architecture compliance, TypeScript best practices, and performance anti-patterns. Use when reviewing code quality, checking architecture boundaries, or validating TypeScript patterns.
version: 1.1.0
source: docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md
source_sections: §2 (Core Principles), §4 (Hexagonal Architecture)
last_updated: 2026-01-22
allowed-tools: Read, Grep, Glob
---

# Code Quality Skill

**Source**: `docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md` §2, §4 (canonical)

## When to Use

Activate this skill when:

- Reviewing code for SOLID/DRY compliance
- Checking hexagonal architecture boundaries
- Validating TypeScript best practices
- Identifying performance anti-patterns
- Preparing for code review

**Use skill first**: Validate code against quality patterns.

**Spawn code-reviewer agent when**: Multi-package changes need holistic review, architecture boundary violations require refactoring guidance, or pre-wu:done final review is needed.

## Quick Reference: SOLID Principles

| Principle                 | Check                  | Violation                           |
| ------------------------- | ---------------------- | ----------------------------------- |
| **S**ingle Responsibility | One reason to change   | Class handles UI + DB + validation  |
| **O**pen/Closed           | Extend, don't modify   | Adding `if` branches for new types  |
| **L**iskov Substitution   | Subtypes replaceable   | Override throws unexpected errors   |
| **I**nterface Segregation | Small interfaces       | Fat interfaces force unused methods |
| **D**ependency Inversion  | Depend on abstractions | Direct `new ConcreteService()`      |

## Hexagonal Architecture Boundaries

```
┌─────────────────────────────────────────────────┐
│                    apps/                         │
│  (API routes, UI components, entry points)      │
├─────────────────────────────────────────────────┤
│                   application                    │
│  (Use cases, business logic, orchestration)     │
│              DEPENDS ON ↓                        │
├─────────────────────────────────────────────────┤
│                     ports                        │
│  (Interfaces ONLY - no implementations)         │
├─────────────────────────────────────────────────┤
│                 infrastructure                   │
│  (Adapters: DB, APIs, external services)        │
│              IMPLEMENTS ↑                        │
└─────────────────────────────────────────────────┘
```

**Forbidden imports**:

```typescript
// ❌ FORBIDDEN: application importing infrastructure
import { DatabaseClient } from './infrastructure';

// ✅ CORRECT: application imports port interface only
import type { DatabasePort } from './ports';
```

## TypeScript Standards

### Required Patterns

```typescript
// ✅ Explicit return types on exported functions
export function calculate(input: Input): Result { ... }

// ✅ Strict null checks - handle undefined
const value = data?.field ?? defaultValue;

// ✅ Discriminated unions over type assertions
type Result = { success: true; data: T } | { success: false; error: string };

// ✅ Const assertions for literals
const MODES = ['default', 'strict', 'loose'] as const;
type Mode = typeof MODES[number];
```

### Anti-Patterns to Reject

```typescript
// ❌ Using `any` - loses type safety
function process(data: any) { ... }

// ❌ Type assertions without validation
const user = response as User;

// ❌ Non-null assertions without guards
const name = user!.name;

// ❌ Implicit any in callbacks
items.map(item => item.value);  // Missing type annotation
```

## DRY Validation

**Duplication threshold**: 3+ repetitions → extract

```typescript
// ❌ Duplicated validation logic
if (!data.title || data.title.length < 3) { ... }
// ... repeated in 4 places

// ✅ Extracted to reusable validator
import { validateTitle } from '@/lib/validators';
```

## Performance Anti-Patterns

| Pattern              | Problem           | Fix                          |
| -------------------- | ----------------- | ---------------------------- |
| N+1 queries          | Loop with DB call | Batch fetch, use `IN` clause |
| Unbounded lists      | Memory exhaustion | Add pagination, limits       |
| Missing memoization  | Expensive recalc  | `useMemo`, `React.memo`      |
| Sync in async path   | Blocks event loop | Use async/await              |
| Large bundle imports | Slow page load    | Tree-shake, lazy load        |

## Common Violations Checklist

Before approving code, verify:

- [ ] No application → infrastructure imports
- [ ] No `any` types (use `unknown` + type guards if needed)
- [ ] No magic numbers (extract to named constants)
- [ ] No hardcoded strings (use constants or config)
- [ ] No regex for structured data (use libraries: date-fns, yaml, etc.)
- [ ] Error handling present (try/catch or Result type)
- [ ] Tests exist for new/changed code
- [ ] No console.log (use logger)

## When to Escalate

Flag for human review if:

- Architecture boundary violation requires refactor
- Performance issue needs profiling
- Security pattern unclear
- Business logic ambiguous

## Integration with Other Skills

- **tdd-workflow**: Use together when implementing new features
- **lumenflow-gates**: Quality checks overlap with gate requirements
