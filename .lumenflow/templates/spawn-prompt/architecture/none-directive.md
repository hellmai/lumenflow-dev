---
id: architecture-none
name: No Architecture Directive
required: false
order: 6
tokens: []
condition: "policy.architecture === 'none'"
---

## ARCHITECTURE GUIDANCE

No specific architecture pattern is enforced for this project.

### Recommendations

While no pattern is mandated, consider:

- Keeping related code together
- Avoiding circular dependencies
- Separating concerns where it makes sense
- Using clear naming conventions

### Flexibility

You have freedom to organize code as fits your needs:

- Single-file scripts
- Feature-based folders
- Domain-driven organization
- Whatever makes sense for your context

### Best Practices Still Apply

Even without an enforced pattern:

- Keep functions focused and small
- Avoid deep nesting
- Write self-documenting code
- Document non-obvious decisions
