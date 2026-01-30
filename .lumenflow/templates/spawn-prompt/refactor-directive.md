---
id: refactor-directive
name: Refactor Directive
required: false
order: 15
tokens: []
condition: "type === 'refactor'"
---

## Refactor Testing

**Existing tests must pass** - No new tests mandated for pure refactors.

### Requirements

1. All existing tests must continue to pass
2. No behavioral changes (output should be identical)
3. Run `pnpm gates` to verify no regressions
4. Document any performance improvements
