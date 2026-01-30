---
id: tdd-directive
name: TDD Directive
required: false
order: 10
tokens: []
condition: "type !== 'documentation' && type !== 'docs' && type !== 'config'"
---

## TDD DIRECTIVE - READ BEFORE CODING

**IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST, YOU HAVE FAILED THIS WU.**

### Test-First Workflow (MANDATORY)

1. Write a failing test for the acceptance criteria
2. Run the test to confirm it fails (RED)
3. Implement the minimum code to pass the test
4. Run the test to confirm it passes (GREEN)
5. Refactor if needed, keeping tests green

### Test Ratchet Rule

Gates compare test results against `.lumenflow/test-baseline.json`:

- **NEW failures** (not in baseline) **BLOCK** gates - you must fix them
- **Pre-existing failures** (in baseline) show **WARNING** - do not block your WU
- When tests are **fixed**, baseline auto-updates (ratchet forward)

If gates fail due to test failures:

1. Check if failure is in baseline: `cat .lumenflow/test-baseline.json`
2. If pre-existing: continue, it will warn but not block
3. If NEW: fix the test or add to baseline with reason and fix-wu

### Why This Matters

- Tests document expected behavior BEFORE implementation
- Prevents scope creep and over-engineering
- Ensures every feature has verification
- Failing tests prove the test actually tests something
- Ratchet pattern prevents being blocked by unrelated failures
