---
id: documentation-directive
name: Documentation Directive
required: false
order: 10
tokens: []
condition: "type === 'documentation' || type === 'docs' || type === 'config'"
---

## Documentation Standards

**Format check only** - No TDD required for documentation WUs.

### Requirements

1. Run `pnpm gates --docs-only` before completion
2. Ensure markdown formatting is correct
3. Verify links are valid
4. Check spelling and grammar
