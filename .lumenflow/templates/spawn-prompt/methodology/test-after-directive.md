---
id: methodology-test-after
name: Test-After Methodology Directive
required: false
order: 5
tokens: []
condition: "policy.testing === 'test-after'"
---

## TEST-AFTER DIRECTIVE

**Implementation-first is acceptable, but tests must be written before marking the WU as done.**

### Workflow

1. Implement the feature based on acceptance criteria
2. Write tests that verify the implementation works
3. Ensure tests pass before running gates
4. Run `pnpm gates` before `pnpm wu:done`

### Test Requirements

- All acceptance criteria must have corresponding tests
- Tests should cover happy path and edge cases
- Tests must pass before WU completion

### Coverage Requirements

- **Target**: 70% coverage on new code (configurable)
- **Mode**: Warn (gates warn but do not fail on coverage)

### Test Ratchet Rule

Gates compare test results against `.lumenflow/test-baseline.json`:

- **NEW failures** (not in baseline) **BLOCK** gates - you must fix them
- **Pre-existing failures** (in baseline) show **WARNING** - do not block your WU
- When tests are **fixed**, baseline auto-updates (ratchet forward)

### Why This Approach

- Faster initial prototyping
- Tests verify actual behavior
- Flexibility for exploration
- Still ensures quality before merge
