# TDD Workflow Rules

**Last updated:** 2026-01-19

Test-Driven Development (TDD) is mandatory for all code changes in LumenFlow.

---

## The TDD Cycle

```
RED -> GREEN -> REFACTOR
 |       |          |
 |       |          +-- Improve code, tests stay green
 |       +-- Write minimum code to pass
 +-- Write failing test first
```

### Step 1: RED (Write Failing Test)

```typescript
// Write a test that fails
it('should calculate total price with discount', () => {
  const result = calculateTotal(100, 0.1);
  expect(result).toBe(90);
});
```

Run the test to confirm it fails:

```bash
pnpm test
# FAIL: calculateTotal is not defined
```

**Why:** A failing test proves the test actually tests something.

### Step 2: GREEN (Make It Pass)

Write the minimum code to make the test pass:

```typescript
function calculateTotal(price: number, discount: number): number {
  return price * (1 - discount);
}
```

Run the test:

```bash
pnpm test
# PASS
```

### Step 3: REFACTOR (Clean Up)

Improve the code while keeping tests green:

```typescript
function calculateTotal(price: number, discountRate: number): number {
  if (discountRate < 0 || discountRate > 1) {
    throw new Error('Discount rate must be between 0 and 1');
  }
  return price * (1 - discountRate);
}
```

Run tests again:

```bash
pnpm test
# PASS
```

---

## Coverage Requirements

- **New application code:** >= 90% coverage
- **Infrastructure adapters:** >= 80% coverage
- **Documentation WUs:** No coverage requirement (no code changes)

---

## Test Organization

```
packages/@project/application/
├── src/
│   ├── usecases/
│   │   └── calculateTotal.ts
│   └── __tests__/
│       └── calculateTotal.test.ts
```

### Test File Naming

- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

---

## Test Structure (Arrange-Act-Assert)

```typescript
describe('calculateTotal', () => {
  it('should apply discount correctly', () => {
    // Arrange
    const price = 100;
    const discount = 0.1;

    // Act
    const result = calculateTotal(price, discount);

    // Assert
    expect(result).toBe(90);
  });
});
```

---

## Mocking Guidelines

### DO Mock:

- External APIs (databases, HTTP clients)
- Time-dependent functions
- File system operations
- Third-party services

### DO NOT Mock:

- Your own domain logic
- Standard library functions
- Language primitives

---

## When to Write Tests

### Before Implementation (TDD)

For acceptance criteria, write tests first:

```yaml
acceptance:
  - User can calculate order total with discount
```

```typescript
// Write this BEFORE the implementation
describe('Order total calculation', () => {
  it('should apply percentage discount', () => {
    // ...
  });

  it('should handle zero discount', () => {
    // ...
  });

  it('should reject negative prices', () => {
    // ...
  });
});
```

### Bug Fixes

Always write a failing test that reproduces the bug first:

```typescript
// This test should fail before the fix
it('should handle edge case that caused bug #123', () => {
  // Reproduce the bug scenario
  const result = buggyFunction(edgeCaseInput);
  expect(result).toBe(expectedOutput);
});
```

---

## Docs-Only WUs

Documentation WUs (type: `documentation`) don't require tests:

```bash
# Use docs-only gates
pnpm gates --docs-only
```

This skips lint, typecheck, and tests.

---

## Anti-Patterns

### DO NOT:

- Write implementation before tests
- Skip the RED phase (failing test)
- Mock your own business logic
- Use `--skip-gates` for new test failures

### DO:

- Write the test first, watch it fail
- Write minimum code to pass
- Refactor with confidence (tests are green)
- Keep tests focused and independent
