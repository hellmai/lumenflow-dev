# ADR-004: Standardized Error Return Contracts

**Status:** Accepted
**Date:** 2026-02-24
**Authors:** Tom @ HellmAI
**Initiative:** INIT-037 (Enforcement Hardening)
**WU:** WU-2128

## Context

The `@lumenflow/core` package had inconsistent error handling contracts across its hexagonal architecture layers:

1. **Ports**: Some methods returned `null` on failure, some threw, some returned `{ valid: boolean }`. No documented or enforced contract.

2. **Adapters**: Thin wrappers that delegated to implementation functions without consistent error handling. Callers could not predict whether a failure would produce an exception or a null/falsy return value.

3. **CLI command handlers**: Had to guess which calls might throw and wrap them in ad-hoc try-catch blocks, leading to inconsistent error formatting.

This lack of a documented contract made it difficult to:

- Write robust error handling in use cases and command handlers
- Test error paths consistently
- Onboard new contributors who needed to understand the expected behavior

## Decision

We adopt a **three-layer error contract** aligned with the existing hexagonal architecture:

### Layer 1: Ports THROW on failure

Port interface methods throw exceptions on failure. This is the boundary contract at the hexagonal architecture edge.

- **Rationale**: Port methods represent domain operations with clear success/failure semantics. Throwing makes the failure path impossible to ignore, which is the correct behavior at architectural boundaries.
- **"Not found" is not an error**: Methods return `null` or `undefined` when the requested entity does not exist (e.g., `readWuState` returns `null` for a non-existent WU). This is a valid result, not an error condition.
- **Query methods return empty collections**: Methods like `getByStatus` return empty `Set<string>` when no matching items exist.

```typescript
// Port contract: THROWS on failure
interface IWuStateReader {
  /** @throws Error if YAML reading/parsing fails */
  readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null>;
}
```

### Layer 2: Adapters return `Result<T, E>`

Adapter classes provide companion `*Safe` methods that return a `Result<T, E>` discriminated union instead of throwing. This enables callers to handle errors explicitly without try-catch.

- **Backward compatible**: The original throwing methods are preserved unchanged.
- **Naming convention**: Safe methods use the `*Safe` suffix (e.g., `resolveLocationSafe`, `readGitStateSafe`).
- **Error wrapping**: Non-Error throws are wrapped in `Error` instances for type safety.

```typescript
// Adapter contract: RETURNS Result<T, Error>
class SimpleGitLocationAdapter implements ILocationResolver {
  // Port contract (throws)
  async resolveLocation(cwd?: string): Promise<LocationContext> { ... }

  // Adapter contract (returns Result)
  async resolveLocationSafe(cwd?: string): Promise<Result<LocationContext>> { ... }
}
```

### Layer 3: CLI catches and formats

CLI command handlers catch exceptions from port methods (or use `*Safe` adapter methods) and format errors for user-facing output with actionable fix suggestions.

### The `Result<T, E>` Type

A discriminated union defined in `@lumenflow/core/src/domain/result.ts`:

```typescript
type Result<T, E = Error> = Success<T> | Failure<E>;

interface Success<T> {
  readonly ok: true;
  readonly value: T;
}
interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}
```

Constructor functions: `ok(value)`, `fail(error)`
Utilities: `unwrap()`, `unwrapOr()`, `mapResult()`, `tryCatch()`, `tryCatchAsync()`

## Consequences

### Positive

- **Predictable error handling**: Every port/adapter method has a documented contract.
- **Type-safe error handling**: `Result<T, E>` enables exhaustive checking via the `ok` discriminant.
- **Backward compatible**: Existing code using throwing port methods continues to work unchanged.
- **Testable**: Error paths can be tested without try-catch in test code (via `*Safe` methods).

### Negative

- **Two methods per operation**: Adapters now have both throwing and Result-returning variants, increasing API surface.
- **Migration cost**: Existing callers that want Result semantics must be updated to use `*Safe` methods.

### Neutral

- **No runtime cost**: `Result` is a plain object; no class instantiation or prototype chain overhead.
- **Consistent with existing patterns**: The codebase already uses `ParseResult<T>` in `test-baseline.ts` with the same `{ success: true; data: T } | { success: false; error: string }` shape.

## Alternatives Considered

1. **Throw everywhere (no Result type)**: Rejected because callers would need try-catch everywhere, reducing readability and making error handling easy to forget.

2. **Result everywhere (no throwing)**: Rejected because it would break the existing port interface contracts and require updating all consumers simultaneously. Also, throwing at port boundaries is the standard hexagonal architecture pattern.

3. **neverthrow library**: Rejected per library-first evaluation -- the Result type is trivial (30 lines) and adding a dependency for it would be over-engineering. The codebase already has the pattern in `ParseResult<T>`.

4. **Replace throwing methods**: Rejected for backward compatibility. The existing port contracts are used by consumers (use cases, CLI handlers). Replacing them would be a breaking change requiring coordinated updates.

## References

- [ADR-001: Hexagonal Architecture](ADR-001-hexagonal-architecture.md)
- [WU-2128 YAML spec](../tasks/wu/WU-2128.yaml)
- [INIT-037 plan](wild-foraging-taco.md) - Phase 3, Item P
