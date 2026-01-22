---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces. Use when building React components, pages, UI features, or when user requests visual/design work.
version: 1.0.0
source: docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md
last_updated: 2026-01-22
allowed-tools: Read, Write, Edit, Bash
---

# Frontend Design Skill

## Purpose

Create distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics.

## When to Use

- Building new React components or pages
- Creating UI features or visual elements
- User requests "make it look good" or design-focused work
- Implementing dashboards, forms, or interactive features
- Working on Experience/UI lane WUs with components

## Capabilities

This skill provides patterns for:

- **Creative UI generation** - Distinctive designs, not generic templates
- **Production-ready code** - Clean, maintainable React/TypeScript
- **Design system awareness** - Respects existing component libraries
- **Accessibility built-in** - WCAG compliance by default
- **Responsive design** - Mobile-first approach

## Common Tech Stack Patterns

Projects commonly use:

- **Tailwind CSS** for styling
- **shadcn/ui** or similar component libraries
- **React 18+** with TypeScript
- **Next.js** App Router (for Next.js projects)

Adapt to your project's specific stack.

## Accessibility Requirements

All UI must meet:

- WCAG 2.1 AA compliance
- Screen reader compatibility
- Keyboard navigation support
- Sufficient colour contrast

## Component Patterns

### File Organization

```
components/
├── ui/           # Primitive UI components
├── features/     # Feature-specific components
├── layouts/      # Layout components
└── forms/        # Form components
```

### Component Structure

```typescript
// components/features/user-card.tsx
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface UserCardProps {
  name: string;
  email: string;
  avatar?: string;
}

export function UserCard({ name, email, avatar }: UserCardProps) {
  return (
    <Card>
      <CardHeader>
        {avatar && <img src={avatar} alt="" className="h-10 w-10 rounded-full" />}
        <h3 className="font-semibold">{name}</h3>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{email}</p>
      </CardContent>
    </Card>
  );
}
```

## Usage Pattern

```markdown
1. Activate this skill when UI work is needed
2. Describe the component/page requirements
3. Specify any design constraints or existing patterns to follow
4. Review generated code for project conventions
5. Test accessibility with screen reader and keyboard
```

## Example Prompts

**Component creation**:

> "Create a user profile card component that displays avatar, name, email, and status. Should match our existing card style."

**Page layout**:

> "Build a dashboard page showing metrics with charts and a recent activity feed."

**Form design**:

> "Design an accessible multi-step form for user registration."

## Quality Checklist

Before completing UI work:

- [ ] Responsive across breakpoints (mobile, tablet, desktop)
- [ ] Keyboard navigable (Tab, Enter, Escape)
- [ ] Screen reader friendly (proper ARIA labels)
- [ ] Colour contrast meets WCAG AA
- [ ] Loading and error states handled
- [ ] Animations respect `prefers-reduced-motion`

## Related Skills

- **tdd-workflow** - For component testing approach
- **code-quality** - For TypeScript patterns
