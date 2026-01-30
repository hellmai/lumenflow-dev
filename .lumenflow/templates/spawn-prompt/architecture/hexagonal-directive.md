---
id: architecture-hexagonal
name: Hexagonal Architecture Directive
required: false
order: 6
tokens: []
condition: "policy.architecture === 'hexagonal'"
---

## HEXAGONAL ARCHITECTURE DIRECTIVE

Follow the Ports and Adapters pattern for clean separation of concerns.

### Package Structure

```
packages/
  @{project}/ports/          # Interfaces only (no implementation)
  @{project}/application/    # Business logic (use cases)
  @{project}/infrastructure/ # Adapters (DB, APIs, external services)
```

### Golden Rules

1. **Ports First**: Define interfaces before implementation
2. **No application to infrastructure imports**: `application/` NEVER imports from `infrastructure/`
3. **Dependency Injection**: Use cases receive dependencies as parameters
4. **Single Responsibility**: Each use case does one thing well

### Implementation Pattern

```typescript
// 1. Define Port (interface)
// packages/@{project}/ports/src/ports.ts
export interface WidgetRepository {
  findById(id: string): Promise<Widget | null>;
  save(widget: Widget): Promise<Widget>;
}

// 2. Implement Use Case (depends on port)
// packages/@{project}/application/src/usecases/create-widget.ts
export async function createWidget(
  deps: { repository: WidgetRepository },
  input: CreateWidgetInput,
): Promise<Widget> {
  // Business logic here
}

// 3. Create Adapter (implements port)
// packages/@{project}/infrastructure/src/supabase/SupabaseWidgetRepository.ts
export class SupabaseWidgetRepository implements WidgetRepository {
  // Implementation using Supabase
}
```

### Testing Strategy

- **Application Layer**: Unit tests with mocked ports (90% coverage)
- **Infrastructure Layer**: Integration tests with real dependencies (80% coverage)
- **Domain Layer**: Pure unit tests, no mocks needed

### Why This Matters

- Clear boundaries prevent spaghetti code
- Easy to swap implementations
- Testable business logic
- Scales with team size
