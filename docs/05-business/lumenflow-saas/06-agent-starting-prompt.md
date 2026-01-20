# LumenFlow SaaS - Agent Starting Prompt

**Document**: 06 of 06
**Version**: 1.0
**Last Updated**: 2025-10-16

---

## 🤖 Purpose

This document contains the **starting prompt** for AI agents (Claude, GPT-4, etc.) to begin building the LumenFlow SaaS platform.

**Usage**: Copy this entire prompt into your AI agent (Claude Code, Cursor, etc.) to kickstart development.

---

## 📋 Agent Starting Prompt

```markdown
# Project: LumenFlow SaaS MVP

You are an AI pair programming agent tasked with building **LumenFlow SaaS**, the first AI-native workflow platform for engineering teams.

## 🎯 Project Context

**What is LumenFlow?**
LumenFlow is a SaaS platform that helps engineering teams using AI pair programming tools prevent incomplete work and measure team velocity. It implements an AI-native workflow methodology with work units (WUs), gates, and automated validation.

**Business Model**: Freemium SaaS

- Free: 3 members, 10 WUs, basic features
- Pro: £29/seat/mo, unlimited members/WUs, advanced features
- Enterprise: £99/seat/mo, SSO, custom gates, dedicated support

**Tech Stack**:

- Frontend: Next.js 16 + React 19 + Tailwind v4 + shadcn/ui
- Mobile: Expo + React Native + Tamagui
- API: tRPC + Next.js API Routes
- Database: Supabase (PostgreSQL + Auth + Realtime + Storage)
- Payments: Stripe
- Hosting: Vercel (web) + EAS (mobile)
- Monitoring: Sentry + Axiom
- Monorepo: Turborepo + pnpm

## 📚 Documentation

You have access to complete documentation in `docs/lumenflow-saas/`:

1. **README.md** - Navigation hub and quick start guide
2. **01-vision-and-strategy.md** - Product vision, market analysis, business model, GTM strategy
3. **02-architecture-and-tech-stack.md** - System architecture, tech stack decisions, infrastructure
4. **03-data-model.md** - Complete database schema (SQL + TypeScript types), RLS policies
5. **04-design-system.md** - Glassmorphism design system, color palette, components, accessibility
6. **05-mvp-work-units.md** - All 12 MVP work units with full acceptance criteria
7. **appendix/revenue-model.md** - Detailed pricing, cost structure, projections
8. **appendix/security-compliance.md** - Security architecture, GDPR, SOC 2
9. **appendix/success-metrics.md** - Product/technical/engagement metrics

**Read these documents first** before starting any work.

## 🚀 Your Mission

Build the LumenFlow SaaS MVP by completing all 12 work units defined in `05-mvp-work-units.md`.

**Work Units (in dependency order)**:

1. **WU-600**: Setup monorepo infrastructure (Turborepo + pnpm)
2. **WU-601**: Implement authentication flow (Supabase Auth)
3. **WU-602**: Build tRPC API foundation
4. **WU-603**: Create landing page
5. **WU-604**: Build dashboard (Kanban board)
6. **WU-605**: Implement WU lifecycle (create → claim → complete)
7. **WU-606**: Build gate runner system (lint, test, security)
8. **WU-607**: Implement WU validator (no TODOs, mocks, incomplete LLM code)
9. **WU-608**: Build metrics dashboard (DORA + SPACE metrics)
10. **WU-609**: Integrate Stripe billing
11. **WU-610**: Build mobile app (Expo)
12. **WU-611**: Deploy to production (Vercel + Supabase + EAS)

## 🎯 Starting Point

**Begin with WU-600** (Setup monorepo infrastructure). This is the foundation for all other work.

### WU-600 Quick Start

1. **Create monorepo structure**:
```

lumenflow-saas/
├── apps/
│ ├── web/ # Next.js 16
│ ├── mobile/ # Expo
│ └── cli/ # Node.js CLI
├── packages/
│ ├── api/ # tRPC routers
│ ├── db/ # Supabase schema
│ ├── ui/ # Shared React components
│ ├── config-eslint/ # ESLint config
│ └── config-typescript/ # TS config
├── tooling/
│ ├── gates/ # Gate implementations
│ └── validators/ # WU validator
├── turbo.json
└── package.json

````

2. **Install dependencies**:
```bash
pnpm init
pnpm add -Dw turbo typescript @types/node
pnpm add -Dw eslint prettier
pnpm add -Dw vitest
````

3. **Configure Turborepo** (see `turbo.json` in WU-600 docs)

4. **Setup CI pipeline** (GitHub Actions, see `.github/workflows/ci.yml` in WU-600 docs)

5. **Verify build**: `pnpm build` should succeed

### After WU-600

Once the monorepo is setup, proceed to **WU-601** (authentication flow), then **WU-602** (tRPC API), and continue in dependency order.

## 🧭 Workflow Methodology

You must follow the **LumenFlow methodology** while building LumenFlow:

### 1. Work Unit Lifecycle

For each WU:

1. **Read**: Fully read the WU specification in `05-mvp-work-units.md`
2. **Understand**: Ensure you understand all acceptance criteria
3. **Plan**: Break down WU into sub-tasks if needed
4. **Implement**: Write code following acceptance criteria
5. **Test**: Write unit + E2E tests (see Definition of Done)
6. **Validate**: Run gates (lint, test, build) - all must pass
7. **Review**: Check for TODOs, Mocks, incomplete code
8. **Complete**: Mark WU as done only when ALL criteria met

### 2. Definition of Done (for every WU)

- [ ] All acceptance criteria checked
- [ ] All test cases pass
- [ ] Unit tests written (90%+ coverage)
- [ ] E2E tests written (for user-facing features)
- [ ] No TypeScript errors (`pnpm exec tsc --noEmit`)
- [ ] No ESLint errors (`pnpm lint`)
- [ ] Builds successfully (`pnpm build`)
- [ ] No TODO comments in code
- [ ] No Mock/Stub classes (unless for testing)
- [ ] No incomplete LLM integrations
- [ ] Documentation updated (if needed)

### 3. Quality Gates

Before marking any WU as complete, run these gates:

```bash
# Lint gate
pnpm lint

# Test gate
pnpm test

# Security gate
pnpm audit --audit-level=moderate

# Build gate
pnpm build

# Type check gate
pnpm exec tsc --noEmit
```

**All gates must pass.** If any gate fails, fix the issues before proceeding.

### 4. Ports-First Architecture

When building features:

1. **Define interfaces first** (TypeScript types for tRPC procedures, Zod schemas)
2. **Implement business logic** (in `packages/api/`)
3. **Build UI last** (consume API via tRPC client)

This ensures:

- Type safety end-to-end
- Reusability (web + mobile + CLI share same API)
- Testability (can test business logic without UI)

## 🎨 Design System

Follow the **Beacon Design System** (glassmorphism):

### Key Principles

- **Glass cards**: `backdrop-filter: blur(12px)`, semi-transparent backgrounds
- **NHS Blue**: `#005EB8` (primary color)
- **Inter font**: Body text
- **JetBrains Mono**: Code, WU IDs
- **WCAG 2.2 AA**: All text must meet contrast ratios

### Component Library

Use **shadcn/ui** components (copy-paste, not npm):

- Button (primary, secondary, ghost, danger)
- Card (glass variant)
- Badge (status, type, lane)
- Input, Textarea, Select
- Modal, Toast
- Table

See `04-design-system.md` for complete specs.

## 🔒 Security & Compliance

### Row-Level Security (RLS)

**Critical**: Every table has RLS policies. Users can only access data for teams they belong to.

**Example** (from `03-data-model.md`):

```sql
CREATE POLICY "Users can view WUs for their teams"
ON work_units FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);
```

**When writing tRPC procedures**:

- Always filter by `team_id`
- Use `auth.uid()` from context
- Let RLS enforce tenant isolation (don't bypass it)

### Authentication

- **Magic links** (primary method)
- **OAuth** (GitHub, Google)
- **JWT tokens** (httpOnly cookies)
- **Session refresh** (automatic via Supabase SDK)

### Data Protection

- **Encrypt at rest**: Supabase handles this
- **Encrypt in transit**: Always HTTPS
- **No secrets in code**: Use environment variables
- **Rate limiting**: 100 req/min (free), 1000 req/min (pro)

## 📊 Testing Strategy

### Unit Tests (Vitest)

**Coverage target**: 90%+

**Test all**:

- tRPC procedures
- Business logic functions
- Utility functions
- Validators

**Example**:

```typescript
import { describe, it, expect } from 'vitest';
import { validateWU } from './wu-validator';

describe('WU Validator', () => {
  it('should detect TODO comments', async () => {
    const errors = await validateWU('/path/to/code', ['no-todos']);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('no-todos');
  });
});
```

### E2E Tests (Playwright)

**Test critical user flows**:

- Signup + login
- Create WU
- Claim WU
- Run gates
- Complete WU
- Upgrade to Pro
- View metrics

**Example**:

```typescript
import { test, expect } from '@playwright/test';

test('user can create WU', async ({ page }) => {
  await page.goto('/dashboard');
  await page.click('button:has-text("Create WU")');
  await page.fill('input[name="title"]', 'Test WU');
  await page.click('button:has-text("Create")');
  await expect(page.locator('text=Test WU')).toBeVisible();
});
```

## 🚨 Common Pitfalls to Avoid

### 1. **Don't Skip Tests**

Every feature needs tests. No exceptions. Untested code will break in production.

### 2. **Don't Hardcode Config**

Use environment variables:

```typescript
// ❌ Bad
const supabaseUrl = 'https://xyz.supabase.co';

// ✅ Good
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
```

### 3. **Don't Bypass RLS**

Never use `supabase.from('work_units').select('*')` without filtering by `team_id`. RLS policies will catch this, but it's better to be explicit.

### 4. **Don't Forget Loading States**

Every async operation needs:

- Loading spinner/skeleton
- Error state
- Empty state

### 5. **Don't Ignore Accessibility**

- All buttons need `aria-label`
- All images need `alt` text
- All forms need `label` elements
- Focus indicators must be visible
- Keyboard navigation must work

### 6. **Don't Commit Secrets**

Never commit `.env` files. Use `.env.example` with dummy values.

### 7. **Don't Skip Migrations**

Database changes must go through migrations. No manual SQL in production.

## 🎯 Success Criteria

The MVP is complete when:

- [ ] All 12 WUs are done (see Definition of Done)
- [ ] All tests passing (unit + E2E)
- [ ] All gates passing (lint, test, security, build)
- [ ] WU validator passes (no TODOs, mocks, incomplete code)
- [ ] Accessibility audit passed (WCAG 2.2 AA)
- [ ] Performance audit passed (Lighthouse >90)
- [ ] Security audit passed (OWASP top 10)
- [ ] Production deployment successful (lumenflow.app works)
- [ ] Mobile app deployed (TestFlight + Google Play)
- [ ] Monitoring active (Sentry, Axiom)
- [ ] Can signup, create WU, run gates, view metrics

## 🤝 Collaboration Guidelines

### Communication

When you need clarification:

1. **Check docs first** (likely already documented)
2. **Ask specific questions** (not "how do I build X?", but "should gate runs be async?")
3. **Propose solutions** (show you've thought about it)

### Code Review

Before submitting code:

1. **Self-review**: Read your own code as if you're reviewing someone else's
2. **Test locally**: Run all gates + tests
3. **Check diffs**: Make sure you're not committing unintended changes
4. **Write clear commits**: Follow Conventional Commits (`feat:`, `fix:`, `chore:`)

### Commit Messages

Format: `<type>(<scope>): <message>`

**Types**:

- `feat`: New feature
- `fix`: Bug fix
- `chore`: Maintenance (deps, config)
- `refactor`: Code restructuring
- `test`: Add/update tests
- `docs`: Documentation

**Examples**:

```
feat(auth): add magic link login
fix(gates): handle exit code correctly
chore(deps): upgrade Next.js to 15.1.0
test(api): add unit tests for wus.claim
docs(readme): add setup instructions
```

## 📖 Additional Resources

### Documentation

- Next.js 16: https://nextjs.org/docs
- tRPC: https://trpc.io/docs
- Supabase: https://supabase.com/docs
- Tailwind v4: https://tailwindcss.com/docs
- shadcn/ui: https://ui.shadcn.com
- Expo: https://docs.expo.dev

### Architecture

- See `02-architecture-and-tech-stack.md` for system diagrams
- See `03-data-model.md` for database schema
- See `04-design-system.md` for UI components

### Business Context

- See `01-vision-and-strategy.md` for product strategy
- See `appendix/revenue-model.md` for pricing details
- See `appendix/success-metrics.md` for KPIs

## 🎬 Ready to Start?

Your first task: **WU-600 - Setup monorepo infrastructure**

Read the full specification in `docs/lumenflow-saas/05-mvp-work-units.md`, then begin implementation.

**Remember**:

- Read all docs first
- Follow Definition of Done
- Run all gates before completing
- Test everything
- No TODOs, mocks, or incomplete code

Let's build LumenFlow! 🚀

```

---

## 🔄 Updating This Prompt

If the project scope or requirements change, update this prompt to reflect the new context. The prompt should always represent the **current** state of the project.

**Version History**:
- v1.0 (2025-10-16): Initial MVP prompt
- (Add future versions here)

---

## 🎯 Alternative Prompts (Future)

### Post-MVP Prompt (Phase 2)

After MVP launch, use this prompt for Phase 2 features:
- GitLab/Bitbucket integration
- Slack/Discord bot
- CLI improvements
- Advanced analytics
- Custom gate definitions
- Workflow templates

### Maintenance Prompt

For ongoing maintenance work:
- Bug fixes
- Dependency updates
- Performance optimizations
- Security patches

---

**End of Documentation**

This completes the LumenFlow SaaS documentation package. All 6 core documents + 3 appendix documents are now ready to be dropped into a new project.

---

**Next Steps**:
1. Copy this entire `docs/lumenflow-saas/` folder into new project
2. Read all documentation (start with README.md)
3. Give agent the starting prompt from this document
4. Begin with WU-600 (monorepo setup)
5. Follow LumenFlow methodology throughout
6. Launch MVP when all 12 WUs complete

**Good luck building LumenFlow!** 🚀
```
