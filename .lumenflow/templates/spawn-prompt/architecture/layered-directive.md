---
id: architecture-layered
name: Layered Architecture Directive
required: false
order: 6
tokens: []
condition: "policy.architecture === 'layered'"
---

## LAYERED ARCHITECTURE DIRECTIVE

Follow traditional layer separation for straightforward organization.

### Layer Structure

```
src/
  presentation/   # UI, controllers, API routes
  business/       # Business logic, services
  data/           # Data access, repositories
  shared/         # Utilities, constants, types
```

### Layer Rules

1. **Presentation** may import from: business, shared
2. **Business** may import from: data, shared
3. **Data** may import from: shared only
4. **Shared** has no internal dependencies

### Implementation Pattern

```typescript
// data/repositories/widget-repository.ts
export class WidgetRepository {
  async findById(id: string): Promise<Widget | null> { ... }
  async save(widget: Widget): Promise<Widget> { ... }
}

// business/services/widget-service.ts
export class WidgetService {
  constructor(private repository: WidgetRepository) {}

  async createWidget(input: CreateWidgetInput): Promise<Widget> {
    // Business logic
    return this.repository.save(widget);
  }
}

// presentation/api/widgets.ts
export async function POST(req: Request) {
  const service = new WidgetService(new WidgetRepository());
  return service.createWidget(req.body);
}
```

### Testing Strategy

- **Presentation**: Integration tests with real HTTP
- **Business**: Unit tests with mocked data layer
- **Data**: Integration tests with test database

### Why This Approach

- Simple to understand
- Easy onboarding
- Clear responsibilities
- Works well for smaller projects
