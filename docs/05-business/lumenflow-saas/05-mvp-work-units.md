# LumenFlow SaaS - MVP Work Units

**Document**: 05 of 06
**Version**: 1.0
**Last Updated**: 2025-10-16

---

## 🎯 MVP Scope

This document defines all work units (WUs) required to launch the LumenFlow SaaS MVP.

**MVP Definition**: Minimum viable product with core workflow management features that teams can use to track WUs, run gates, and measure DORA metrics.

**Organization**: WUs are organized by dependency phases (no timescales).

---

## 📋 Work Units Overview

| WU ID      | Title                          | Type    | Lane         | Dependencies   |
| ---------- | ------------------------------ | ------- | ------------ | -------------- |
| **WU-600** | Setup monorepo infrastructure  | chore   | Operations   | None           |
| **WU-601** | Implement authentication flow  | feature | Operations   | WU-600         |
| **WU-602** | Build tRPC API foundation      | feature | Operations   | WU-600         |
| **WU-603** | Create landing page            | feature | Creative     | WU-600         |
| **WU-604** | Build dashboard (Kanban board) | feature | Intelligence | WU-601, WU-602 |
| **WU-605** | Implement WU lifecycle         | feature | Operations   | WU-602, WU-604 |
| **WU-606** | Build gate runner system       | feature | Intelligence | WU-602         |
| **WU-607** | Implement WU validator         | feature | Intelligence | WU-606         |
| **WU-608** | Build metrics dashboard (DORA) | feature | Intelligence | WU-605, WU-606 |
| **WU-609** | Integrate Stripe billing       | feature | Operations   | WU-601         |
| **WU-610** | Build mobile app (Expo)        | feature | Creative     | WU-602, WU-604 |
| **WU-611** | Deploy to production           | chore   | Operations   | All WUs        |

---

## Phase 1: Foundation

### WU-600: Setup monorepo infrastructure

**Type**: chore
**Lane**: Operations
**Priority**: 1 (highest)
**Story Points**: 5
**Dependencies**: None

#### Description

Create the monorepo structure with Turborepo + pnpm workspaces, configure all build tools, and setup CI/CD pipeline.

#### Acceptance Criteria

- [ ] Monorepo created with Turborepo + pnpm
- [ ] Directory structure matches:
  ```
  lumenflow-saas/
  ├── apps/
  │   ├── web/              # Next.js 15
  │   ├── mobile/           # Expo
  │   └── cli/              # Node.js CLI
  ├── packages/
  │   ├── api/              # tRPC routers
  │   ├── db/               # Supabase schema
  │   ├── ui/               # Shared React components
  │   ├── config-eslint/    # ESLint config
  │   └── config-typescript/ # TS config
  ├── tooling/
  │   ├── gates/            # Gate implementations
  │   └── validators/       # WU validator
  ├── turbo.json
  └── package.json
  ```
- [ ] All packages have `package.json` with correct dependencies
- [ ] TypeScript configured (`strict: true`, paths aliases)
- [ ] ESLint + Prettier configured
- [ ] Tailwind v4 installed with design tokens from [04-design-system.md](04-design-system.md)
- [ ] GitHub Actions CI pipeline created:
  - Runs on pull requests
  - Runs `pnpm install`, `pnpm lint`, `pnpm test`, `pnpm build`
  - Fails if any step fails
- [ ] All packages can be built successfully (`pnpm build`)
- [ ] Vitest configured for unit tests

#### Implementation Notes

**Install Dependencies**:

```bash
pnpm init
pnpm add -Dw turbo typescript @types/node
pnpm add -Dw eslint prettier
pnpm add -Dw vitest
```

**Turbo Config** (`turbo.json`):

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**CI Pipeline** (`.github/workflows/ci.yml`):

```yaml
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

#### Definition of Done

- All acceptance criteria checked
- CI pipeline passes
- No TypeScript errors
- No ESLint errors
- README.md created with setup instructions

---

### WU-601: Implement authentication flow

**Type**: feature
**Lane**: Operations
**Priority**: 1
**Story Points**: 8
**Dependencies**: WU-600

#### Description

Implement Supabase Auth with magic links, OAuth (GitHub, Google), and JWT session management.

#### Acceptance Criteria

- [ ] Supabase project created (production + staging)
- [ ] Supabase client configured in `packages/db/supabase.ts`
- [ ] Auth context provider created (`AuthProvider`)
- [ ] Login page (`/login`) with magic link form
- [ ] OAuth buttons (GitHub, Google) configured
- [ ] Signup flow creates team + team_member entry
- [ ] Protected routes redirect to `/login` if not authenticated
- [ ] Logout clears session and redirects to landing page
- [ ] User profile stored in `auth.users` (Supabase)
- [ ] JWT token stored in httpOnly cookie
- [ ] Token refresh handled automatically (Supabase SDK)
- [ ] Auth state persisted in localStorage (Supabase SDK)

#### Implementation Notes

**Supabase Client** (`packages/db/supabase.ts`):

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types'; // Auto-generated

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

**Auth Context** (`apps/web/contexts/AuthContext.tsx`):

```typescript
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@lumenflow/db';
import type { User } from '@supabase/supabase-js';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithOAuth: (provider: 'github' | 'google') => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;
  };

  const signInWithOAuth = async (provider: 'github' | 'google') => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithMagicLink, signInWithOAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

**Protected Route Middleware** (`apps/web/middleware.ts`):

```typescript
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Protected routes
  if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
```

#### Test Cases

- [ ] User can sign up with magic link
- [ ] User receives email with login link
- [ ] Clicking login link authenticates user
- [ ] User can sign in with GitHub OAuth
- [ ] User can sign in with Google OAuth
- [ ] User can sign out
- [ ] Session persists across page refreshes
- [ ] Token refreshes automatically before expiry
- [ ] Protected routes redirect to login

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Unit tests written for AuthContext
- E2E test written for login flow (Playwright)

---

### WU-602: Build tRPC API foundation

**Type**: feature
**Lane**: Operations
**Priority**: 1
**Story Points**: 8
**Dependencies**: WU-600

#### Description

Setup tRPC with Next.js API routes, create base router structure, and implement authentication middleware.

#### Acceptance Criteria

- [ ] tRPC installed (`@trpc/server`, `@trpc/client`, `@trpc/react-query`)
- [ ] tRPC context created with Supabase client
- [ ] Protected procedure middleware created (checks `auth.uid()`)
- [ ] Base router structure created:
  - `auth.router.ts` (signup, login, logout)
  - `teams.router.ts` (CRUD, members, billing)
  - `wus.router.ts` (CRUD, lifecycle, gates)
  - `gates.router.ts` (run, status, results)
  - `metrics.router.ts` (DORA, SPACE)
- [ ] tRPC client configured in `apps/web`
- [ ] React Query provider setup
- [ ] Error handling middleware (TRPCError)
- [ ] Input validation with Zod
- [ ] Auto-generated types work end-to-end

#### Implementation Notes

**tRPC Context** (`packages/api/context.ts`):

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@lumenflow/db';

export async function createContext({ req, res }: { req: Request; res: Response }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: req.headers.get('authorization') ?? '',
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    supabase,
    user,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

**tRPC Router** (`packages/api/index.ts`):

```typescript
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure (requires auth)
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Now non-null
    },
  });
});
```

**Example Router** (`packages/api/routers/wus.ts`):

```typescript
import { router, protectedProcedure } from '../index';
import { z } from 'zod';

export const wusRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('work_units')
        .select('*')
        .eq('team_id', input.teamId)
        .order('created_at', { ascending: false });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  claim: protectedProcedure
    .input(z.object({ wuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('work_units')
        .update({
          status: 'in_progress',
          assigned_to: ctx.user.id,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', input.wuId)
        .single();

      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      return data;
    }),
});
```

**Client Setup** (`apps/web/lib/trpc.ts`):

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@lumenflow/api';

export const trpc = createTRPCReact<AppRouter>();
```

#### Test Cases

- [ ] Public procedure works without auth
- [ ] Protected procedure throws UNAUTHORIZED without auth
- [ ] Protected procedure works with valid JWT
- [ ] Input validation rejects invalid data
- [ ] Error handling returns TRPCError
- [ ] Types are inferred correctly in client

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Unit tests written for all procedures
- API documentation generated (tRPC OpenAPI)

---

## Phase 2: Core Features

### WU-603: Create landing page

**Type**: feature
**Lane**: Creative
**Priority**: 2
**Story Points**: 5
**Dependencies**: WU-600

#### Description

Build marketing landing page with hero section, features, pricing, and CTA.

#### Acceptance Criteria

- [ ] Landing page at `/` (public route)
- [ ] Hero section with headline, subheadline, CTA button
- [ ] Features section (3-4 key features with icons)
- [ ] Pricing section (Free, Pro, Enterprise tiers)
- [ ] FAQ section (5-10 common questions)
- [ ] Footer with links (Docs, Blog, GitHub, Twitter)
- [ ] Fully responsive (mobile, tablet, desktop)
- [ ] Glassmorphism design system applied
- [ ] Lighthouse score >90 (Performance, Accessibility, SEO)
- [ ] Meta tags for SEO (title, description, OG image)

#### Implementation Notes

**Hero Section**:

```tsx
<section className="relative min-h-screen flex items-center justify-center">
  <div className="glass-card p-12 max-w-4xl text-center">
    <h1 className="text-5xl font-bold text-gray-900 mb-6">The First AI-Native Workflow Platform</h1>
    <p className="text-xl text-gray-600 mb-8">
      LumenFlow prevents incomplete work and measures team velocity. Built for teams using AI pair
      programming.
    </p>
    <button className="glass-button-primary text-lg px-8 py-4">Get Started Free</button>
  </div>
</section>
```

**Pricing Table**:

```tsx
<section className="py-20">
  <div className="container">
    <h2 className="text-4xl font-bold text-center mb-12">Simple, Transparent Pricing</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {/* Free Tier */}
      <div className="glass-card p-8">
        <h3 className="text-2xl font-bold mb-4">Free</h3>
        <p className="text-4xl font-bold mb-6">
          £0<span className="text-lg">/month</span>
        </p>
        <ul className="space-y-3 mb-8">
          <li>✓ 1 team (3 members)</li>
          <li>✓ 10 active WUs</li>
          <li>✓ 30-day metrics</li>
        </ul>
        <button className="glass-button w-full">Start Free</button>
      </div>

      {/* Pro Tier */}
      <div className="glass-card p-8 border-2 border-nhs-blue">
        <h3 className="text-2xl font-bold mb-4">Pro</h3>
        <p className="text-4xl font-bold mb-6">
          £29<span className="text-lg">/seat/month</span>
        </p>
        <ul className="space-y-3 mb-8">
          <li>✓ Unlimited members & WUs</li>
          <li>✓ Advanced validator</li>
          <li>✓ All integrations</li>
        </ul>
        <button className="glass-button-primary w-full">Start Trial</button>
      </div>

      {/* Enterprise Tier */}
      <div className="glass-card p-8">
        <h3 className="text-2xl font-bold mb-4">Enterprise</h3>
        <p className="text-4xl font-bold mb-6">
          £99<span className="text-lg">/seat/month</span>
        </p>
        <ul className="space-y-3 mb-8">
          <li>✓ SSO/SAML</li>
          <li>✓ Custom gates</li>
          <li>✓ Dedicated CSM</li>
        </ul>
        <button className="glass-button w-full">Contact Sales</button>
      </div>
    </div>
  </div>
</section>
```

#### Definition of Done

- All acceptance criteria checked
- Lighthouse score >90 on all metrics
- Mobile responsive
- Cross-browser tested (Chrome, Firefox, Safari)

---

### WU-604: Build dashboard (Kanban board)

**Type**: feature
**Lane**: Intelligence
**Priority**: 1
**Story Points**: 13
**Dependencies**: WU-601, WU-602

#### Description

Build main dashboard with Kanban board showing WUs organized by lane and status.

#### Acceptance Criteria

- [ ] Dashboard at `/dashboard` (protected route)
- [ ] Kanban board with lanes (Unrefined, Backlog, Operations, Intelligence, Creative)
- [ ] WU cards display:
  - WU ID (e.g., WU-123)
  - Title
  - Type badge
  - Status badge
  - Assigned user avatar (if claimed)
  - Priority indicator
- [ ] Click WU card to open detail modal
- [ ] Drag-and-drop WUs between lanes (updates database)
- [ ] Real-time updates via Supabase Realtime (see teammate changes live)
- [ ] Filter by status, type, assigned user
- [ ] Search WUs by title/description
- [ ] Create new WU button (opens modal form)
- [ ] Loading states for all async operations
- [ ] Empty states for empty lanes

#### Implementation Notes

**Kanban Board** (`apps/web/components/KanbanBoard.tsx`):

```tsx
'use client';
import { trpc } from '@/lib/trpc';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export function KanbanBoard({ teamId }: { teamId: string }) {
  const { data: wus, isLoading } = trpc.wus.list.useQuery({ teamId });
  const updateWu = trpc.wus.update.useMutation();

  const onDragEnd = (result: any) => {
    if (!result.destination) return;

    const wuId = result.draggableId;
    const newLane = result.destination.droppableId;

    updateWu.mutate({ wuId, lane: newLane });
  };

  if (isLoading) return <LoadingSpinner />;

  const lanes = ['Unrefined', 'Backlog', 'Operations', 'Intelligence', 'Creative'];

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto p-4">
        {lanes.map((lane) => (
          <Droppable key={lane} droppableId={lane}>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="flex-shrink-0 w-80 glass-card p-4"
              >
                <h3 className="font-semibold text-gray-900 mb-4">{lane}</h3>
                <div className="space-y-3">
                  {wus
                    ?.filter((wu) => wu.lane === lane)
                    .map((wu, index) => (
                      <Draggable key={wu.id} draggableId={wu.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <WUCard wu={wu} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                  {provided.placeholder}
                </div>
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
}
```

**Real-time Updates** (Supabase Realtime):

```typescript
useEffect(() => {
  const channel = supabase
    .channel('work_units')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'work_units',
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        // Invalidate React Query cache to refetch
        trpc.useContext().wus.list.invalidate({ teamId });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [teamId]);
```

#### Test Cases

- [ ] Dashboard loads and displays all WUs
- [ ] WUs are grouped by lane correctly
- [ ] Drag-and-drop updates lane in database
- [ ] Real-time updates reflect teammate changes
- [ ] Filters work correctly
- [ ] Search finds WUs by title
- [ ] Create WU modal opens and saves
- [ ] Click WU card opens detail modal

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- E2E test written for drag-and-drop (Playwright)

---

### WU-605: Implement WU lifecycle

**Type**: feature
**Lane**: Operations
**Priority**: 1
**Story Points**: 8
**Dependencies**: WU-602, WU-604

#### Description

Implement complete WU lifecycle: create → claim → work → review → complete.

#### Acceptance Criteria

- [ ] Create WU: Form with title, description, type, lane, priority
- [ ] Claim WU: Button changes status to `in_progress`, sets `assigned_to`, records `claimed_at`
- [ ] Unclaim WU: Button reverts to `backlog`, clears `assigned_to`
- [ ] Mark for review: Changes status to `in_review`
- [ ] Complete WU: Changes status to `done`, records `completed_at`
- [ ] Block WU: Modal to specify `blocked_by` WU IDs
- [ ] Unblock WU: Remove from `blocked_by` array
- [ ] Delete WU: Confirmation modal, soft delete (sets `archived_at`)
- [ ] Activity log created for all transitions (see [03-data-model.md](03-data-model.md#6-activities))
- [ ] Notifications sent on status changes (Supabase Realtime)

#### Implementation Notes

**tRPC Procedures** (`packages/api/routers/wus.ts`):

```typescript
export const wusRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        title: z.string().min(3),
        description: z.string().optional(),
        type: z.enum(['feature', 'bug', 'chore', 'refactor', 'docs', 'test']),
        lane: z.enum(['Unrefined', 'Backlog', 'Operations', 'Intelligence', 'Creative']),
        priority: z.number().int().min(1).max(5).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Generate WU ID (fetch latest ID from DB and increment)
      const { data: latestWu } = await ctx.supabase
        .from('work_units')
        .select('id')
        .eq('team_id', input.teamId)
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const nextId = latestWu ? `WU-${parseInt(latestWu.id.split('-')[1]) + 1}` : 'WU-1';

      const { data, error } = await ctx.supabase
        .from('work_units')
        .insert({
          id: nextId,
          team_id: input.teamId,
          title: input.title,
          description: input.description,
          type: input.type,
          lane: input.lane,
          priority: input.priority,
          status: input.lane === 'Unrefined' ? 'unrefined' : 'backlog',
        })
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  claim: protectedProcedure
    .input(z.object({ wuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('work_units')
        .update({
          status: 'in_progress',
          assigned_to: ctx.user.id,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', input.wuId)
        .single();

      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      return data;
    }),

  complete: protectedProcedure
    .input(z.object({ wuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('work_units')
        .update({
          status: 'done',
          completed_at: new Date().toISOString(),
        })
        .eq('id', input.wuId)
        .eq('assigned_to', ctx.user.id) // Only assigned user can complete
        .single();

      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      return data;
    }),
});
```

#### Test Cases

- [ ] User can create WU
- [ ] User can claim unassigned WU
- [ ] User cannot claim WU already assigned to someone else
- [ ] User can unclaim their own WU
- [ ] User can mark WU for review
- [ ] User can complete WU
- [ ] Activity log entries created for all transitions
- [ ] Notifications sent to teammates

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Unit tests for all lifecycle transitions

---

## Phase 3: Gates & Validation

### WU-606: Build gate runner system

**Type**: feature
**Lane**: Intelligence
**Priority**: 2
**Story Points**: 13
**Dependencies**: WU-602

#### Description

Build system to run gates (lint, test, security scans) against WU branches and report results.

#### Acceptance Criteria

- [ ] Gate runner service in `tooling/gates/`
- [ ] Support for 3 gate types:
  - `lint`: ESLint
  - `test`: Vitest
  - `security`: npm audit
- [ ] tRPC procedure `gates.run` triggers gate execution
- [ ] Gates run in isolated environment (Docker container or separate process)
- [ ] Gate results stored in `gate_runs` table
- [ ] Real-time status updates (pending → running → passed/failed)
- [ ] Gate output (stdout/stderr) captured and stored
- [ ] Gate duration measured
- [ ] Failed gates display error details in UI
- [ ] Gate runs linked to WU in database

#### Implementation Notes

**Gate Runner** (`tooling/gates/runner.ts`):

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type GateType = 'lint' | 'test' | 'security';

export async function runGate(gateType: GateType, workingDir: string) {
  const startTime = Date.now();

  try {
    const command = getGateCommand(gateType);
    const { stdout, stderr } = await execAsync(command, { cwd: workingDir });

    return {
      status: 'passed' as const,
      output: stdout + stderr,
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      status: 'failed' as const,
      output: error.stdout + error.stderr,
      exitCode: error.code,
      duration: Date.now() - startTime,
    };
  }
}

function getGateCommand(gateType: GateType): string {
  switch (gateType) {
    case 'lint':
      return 'pnpm eslint .';
    case 'test':
      return 'pnpm vitest run';
    case 'security':
      return 'pnpm audit --audit-level=moderate';
  }
}
```

**tRPC Procedure** (`packages/api/routers/gates.ts`):

```typescript
import { runGate } from '@lumenflow/gates';

export const gatesRouter = router({
  run: protectedProcedure
    .input(
      z.object({
        wuId: z.string(),
        gateName: z.enum(['lint', 'test', 'security']),
        workingDir: z.string(), // Path to WU worktree
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Create gate run entry
      const { data: gateRun, error: insertError } = await ctx.supabase
        .from('gate_runs')
        .insert({
          work_unit_id: input.wuId,
          gate_name: input.gateName,
          status: 'running',
          triggered_by: ctx.user.id,
        })
        .single();

      if (insertError) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Run gate asynchronously
      runGate(input.gateName, input.workingDir).then(async (result) => {
        await ctx.supabase
          .from('gate_runs')
          .update({
            status: result.status,
            output: result.output,
            exit_code: result.exitCode,
            duration_ms: result.duration,
          })
          .eq('id', gateRun.id);
      });

      return gateRun;
    }),
});
```

#### Test Cases

- [ ] Lint gate passes on clean code
- [ ] Lint gate fails on code with errors
- [ ] Test gate passes when all tests pass
- [ ] Test gate fails when tests fail
- [ ] Security gate passes with no vulnerabilities
- [ ] Security gate fails with vulnerabilities
- [ ] Gate output is captured correctly
- [ ] Gate duration is measured

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Unit tests for gate runner
- E2E test for running gates from UI

---

### WU-607: Implement WU validator

**Type**: feature
**Lane**: Intelligence
**Priority**: 2
**Story Points**: 8
**Dependencies**: WU-606

#### Description

Build WU validator that scans code for incomplete work (TODO comments, Mock classes, incomplete LLM integrations).

#### Acceptance Criteria

- [ ] Validator service in `tooling/validators/`
- [ ] Support for 3 validation rules:
  - `no-todos`: Detect TODO/FIXME comments
  - `no-mocks`: Detect Mock/Stub classes
  - `no-incomplete-llm`: Detect placeholder LLM responses
- [ ] Validator runs automatically when WU is marked for review
- [ ] Validator results stored in `work_units.validator_errors`
- [ ] Failed validation blocks WU completion
- [ ] Validator errors displayed in UI with file/line numbers
- [ ] Team admins can configure which rules are enabled (via `team_config`)

#### Implementation Notes

**Validator** (`tooling/validators/wu-validator.ts`):

```typescript
import { glob } from 'glob';
import { readFileSync } from 'fs';

export type ValidationRule = 'no-todos' | 'no-mocks' | 'no-incomplete-llm';

export type ValidationError = {
  rule: ValidationRule;
  severity: 'error' | 'warning';
  message: string;
  file: string;
  line: number;
};

export async function validateWU(
  workingDir: string,
  rules: ValidationRule[],
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  // Find all source files
  const files = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: workingDir,
    ignore: ['node_modules/**', 'dist/**', '.next/**'],
  });

  for (const file of files) {
    const content = readFileSync(`${workingDir}/${file}`, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (rules.includes('no-todos') && /TODO|FIXME/i.test(line)) {
        errors.push({
          rule: 'no-todos',
          severity: 'error',
          message: 'Found TODO comment',
          file,
          line: index + 1,
        });
      }

      if (rules.includes('no-mocks') && /class\s+\w*Mock|\bMock\b|\bStub\b/.test(line)) {
        errors.push({
          rule: 'no-mocks',
          severity: 'error',
          message: 'Found Mock/Stub class',
          file,
          line: index + 1,
        });
      }

      if (
        rules.includes('no-incomplete-llm') &&
        /placeholder|not implemented|coming soon/i.test(line)
      ) {
        errors.push({
          rule: 'no-incomplete-llm',
          severity: 'warning',
          message: 'Found incomplete LLM integration',
          file,
          line: index + 1,
        });
      }
    });
  }

  return errors;
}
```

#### Test Cases

- [ ] Validator detects TODO comments
- [ ] Validator detects Mock classes
- [ ] Validator detects incomplete LLM code
- [ ] Validator returns empty array for clean code
- [ ] Validation errors stored in database
- [ ] WU completion blocked when validation fails

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Unit tests for all validation rules

---

### WU-608: Build metrics dashboard (DORA)

**Type**: feature
**Lane**: Intelligence
**Priority**: 2
**Story Points**: 13
**Dependencies**: WU-605, WU-606

#### Description

Build metrics dashboard displaying DORA metrics (deployment frequency, lead time, MTTR, change failure rate) and SPACE metrics.

#### Acceptance Criteria

- [ ] Metrics dashboard at `/dashboard/metrics`
- [ ] DORA metrics displayed:
  - Deployment Frequency (WUs completed per week)
  - Lead Time (avg time from claimed → completed)
  - Change Failure Rate (% of WUs with failed gates)
  - Mean Time to Recovery (avg time to fix failed WUs)
- [ ] SPACE metrics displayed:
  - Satisfaction (survey scores, if available)
  - Performance (DORA metrics)
  - Activity (commits, PRs, comments)
  - Communication (comments per WU)
  - Efficiency (WUs completed per sprint)
- [ ] Charts with Recharts:
  - Line chart: Deployments over time
  - Bar chart: Lead time by WU type
  - Pie chart: Change failure rate
- [ ] Date range filter (last 7/30/90 days)
- [ ] Export to CSV button
- [ ] Real-time updates (refresh every 60 seconds)

#### Implementation Notes

**Metrics Query** (`packages/api/routers/metrics.ts`):

```typescript
export const metricsRouter = router({
  dora: protectedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query materialized view (see 03-data-model.md)
      const { data: metrics } = await ctx.supabase
        .from('dora_metrics')
        .select('*')
        .eq('team_id', input.teamId)
        .single();

      // Query raw WUs for detailed charts
      const { data: wus } = await ctx.supabase
        .from('work_units')
        .select('*')
        .eq('team_id', input.teamId)
        .gte('completed_at', input.startDate)
        .lte('completed_at', input.endDate);

      return {
        deploymentFrequency: metrics?.deployments_last_week ?? 0,
        avgLeadTime: metrics?.avg_lead_time_hours ?? 0,
        changeFailureRate: metrics?.change_failure_rate ?? 0,
        gatePassRate: metrics?.gate_pass_rate ?? 0,
        wus,
      };
    }),
});
```

**Dashboard UI** (`apps/web/app/dashboard/metrics/page.tsx`):

```tsx
'use client';
import { trpc } from '@/lib/trpc';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export default function MetricsPage() {
  const { data: metrics } = trpc.metrics.dora.useQuery({
    teamId: 'xxx',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date().toISOString(),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Metrics</h1>

      {/* DORA Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Deployment Frequency"
          value={`${metrics?.deploymentFrequency} / week`}
          trend="+12%"
        />
        <MetricCard
          title="Lead Time"
          value={`${metrics?.avgLeadTime?.toFixed(1)} hours`}
          trend="-8%"
        />
        <MetricCard
          title="Change Failure Rate"
          value={`${(metrics?.changeFailureRate * 100).toFixed(1)}%`}
          trend="-5%"
        />
        <MetricCard
          title="Gate Pass Rate"
          value={`${(metrics?.gatePassRate * 100).toFixed(1)}%`}
          trend="+3%"
        />
      </div>

      {/* Charts */}
      <div className="glass-card p-6">
        <h2 className="text-xl font-semibold mb-4">Deployments Over Time</h2>
        <LineChart width={800} height={300} data={metrics?.wus}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="completed_at" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="story_points" stroke="#005EB8" />
        </LineChart>
      </div>
    </div>
  );
}
```

#### Definition of Done

- All acceptance criteria checked
- Metrics display correctly
- Charts render correctly
- Export to CSV works

---

## Phase 4: Billing & Launch

### WU-609: Integrate Stripe billing

**Type**: feature
**Lane**: Operations
**Priority**: 2
**Story Points**: 13
**Dependencies**: WU-601

#### Description

Integrate Stripe for subscription billing (Free, Pro, Enterprise tiers).

#### Acceptance Criteria

- [ ] Stripe account created (production + test mode)
- [ ] Stripe products created (Pro, Enterprise)
- [ ] Stripe webhook endpoint configured (`/api/webhooks/stripe`)
- [ ] Webhook events handled:
  - `checkout.session.completed`: Create subscription in DB
  - `customer.subscription.updated`: Update subscription in DB
  - `customer.subscription.deleted`: Cancel subscription in DB
  - `invoice.payment_failed`: Send email notification
- [ ] Upgrade flow: Redirect to Stripe Checkout
- [ ] Downgrade flow: Cancel at period end
- [ ] Customer Portal link in settings (manage billing)
- [ ] Usage limits enforced (see `check_team_limits()` in [03-data-model.md](03-data-model.md))
- [ ] Trial period supported (14 days for Pro tier)

#### Implementation Notes

**Stripe Checkout** (`apps/web/app/api/checkout/route.ts`):

```typescript
import { stripe } from '@/lib/stripe';

export async function POST(req: Request) {
  const { teamId, priceId } = await req.json();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId, // Stripe price ID (from env)
        quantity: 1,
      },
    ],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgrade=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgrade=cancel`,
    metadata: { teamId },
  });

  return Response.json({ url: session.url });
}
```

**Webhook Handler** (`apps/web/app/api/webhooks/stripe/route.ts`):

```typescript
import { stripe } from '@/lib/stripe';
import { supabase } from '@lumenflow/db';

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { teamId } = session.metadata;

      await supabase.from('subscriptions').insert({
        team_id: teamId,
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
        stripe_price_id: session.line_items[0].price.id,
        status: 'active',
        current_period_start: new Date(
          session.subscription.current_period_start * 1000,
        ).toISOString(),
        current_period_end: new Date(session.subscription.current_period_end * 1000).toISOString(),
      });

      // Update team tier
      await supabase.from('teams').update({ tier: 'pro' }).eq('id', teamId);
      break;
    }
    // Handle other events...
  }

  return Response.json({ received: true });
}
```

#### Test Cases

- [ ] User can upgrade to Pro tier
- [ ] Stripe Checkout redirects to success page
- [ ] Subscription created in database
- [ ] Team tier updated to Pro
- [ ] Usage limits increased
- [ ] Webhook events processed correctly
- [ ] User can access Customer Portal
- [ ] User can cancel subscription

#### Definition of Done

- All acceptance criteria checked
- All test cases pass
- Stripe webhook signature validation works
- Billing documented for users

---

### WU-610: Build mobile app (Expo)

**Type**: feature
**Lane**: Creative
**Priority**: 3
**Story Points**: 13
**Dependencies**: WU-602, WU-604

#### Description

Build mobile app (iOS + Android) with Expo, reusing tRPC API and core components.

#### Acceptance Criteria

- [ ] Expo app created in `apps/mobile/`
- [ ] Authentication flow (magic link opens app via deep link)
- [ ] Bottom tab navigation (Home, Backlog, Metrics, Settings)
- [ ] Home screen: Activity feed
- [ ] Backlog screen: List view of WUs (filterable)
- [ ] Metrics screen: DORA metrics (simplified)
- [ ] Settings screen: Profile, team, logout
- [ ] WU detail screen: View WU, claim, comment
- [ ] Push notifications for WU status changes (Expo Notifications)
- [ ] Offline support (cache API responses with React Query)
- [ ] App submitted to App Store + Google Play (TestFlight + internal testing)

#### Implementation Notes

**Expo Setup**:

```bash
cd apps/mobile
npx create-expo-app . --template tabs
pnpm add @trpc/client @trpc/react-query @tanstack/react-query
pnpm add expo-router expo-notifications
```

**tRPC Client** (`apps/mobile/lib/trpc.ts`):

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@lumenflow/api';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: process.env.EXPO_PUBLIC_API_URL + '/trpc',
      headers: async () => {
        const token = await SecureStore.getItemAsync('auth_token');
        return { authorization: token ? `Bearer ${token}` : '' };
      },
    }),
  ],
});
```

**Home Screen** (`apps/mobile/app/(tabs)/index.tsx`):

```tsx
import { View, FlatList } from 'react-native';
import { trpc } from '@/lib/trpc';

export default function HomeScreen() {
  const { data: activities } = trpc.activities.list.useQuery({ teamId: 'xxx' });

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={activities}
        renderItem={({ item }) => <ActivityCard activity={item} />}
        keyExtractor={(item) => item.id}
      />
    </View>
  );
}
```

#### Definition of Done

- All acceptance criteria checked
- App builds successfully (iOS + Android)
- App submitted to TestFlight + Google Play
- Deep linking works for magic links
- Push notifications work

---

### WU-611: Deploy to production

**Type**: chore
**Lane**: Operations
**Priority**: 1
**Story Points**: 5
**Dependencies**: All WUs

#### Description

Deploy LumenFlow SaaS to production (Vercel + Supabase + EAS).

#### Acceptance Criteria

- [ ] Vercel project created (connected to GitHub repo)
- [ ] Environment variables configured:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_APP_URL`
- [ ] Supabase production project created
- [ ] Database migrations applied to production
- [ ] Seed data created (if needed)
- [ ] Custom domain configured (`lumenflow.app`)
- [ ] SSL certificate active
- [ ] Vercel Edge Functions deployed
- [ ] Mobile app deployed to EAS (production build)
- [ ] Monitoring configured (Sentry, Axiom)
- [ ] Analytics configured (Vercel Analytics)
- [ ] Status page created (status.lumenflow.app)

#### Implementation Notes

**Vercel Deployment**:

```bash
# Connect to Vercel
vercel link

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# ... (add all env vars)

# Deploy
vercel --prod
```

**Database Migration**:

```bash
# Apply migrations to production
supabase db push --env production
```

**EAS Build**:

```bash
# Build for production
cd apps/mobile
eas build --platform all --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

#### Definition of Done

- All acceptance criteria checked
- Production URL works (`lumenflow.app`)
- Mobile app available on App Store + Google Play
- Monitoring shows no errors
- Performance metrics acceptable (Lighthouse >90)

---

## 🎯 Launch Checklist

**Before Launch**:

- [ ] All 12 WUs completed
- [ ] All tests passing (unit + E2E)
- [ ] All gates passing (lint, test, security)
- [ ] WU validator passes (no TODOs, mocks, incomplete code)
- [ ] Accessibility audit passed (WCAG 2.2 AA)
- [ ] Performance audit passed (Lighthouse >90)
- [ ] Security audit passed (OWASP top 10)
- [ ] Legal pages created (Privacy, Terms, Cookie Policy)
- [ ] Documentation published (docs.lumenflow.app)
- [ ] Blog post written (launch announcement)
- [ ] Social media assets created
- [ ] Launch plan finalized
- [ ] Support email configured (support@lumenflow.app)
- [ ] Error monitoring active (Sentry)
- [ ] Log aggregation active (Axiom)
- [ ] Backup strategy confirmed

**Launch Day**:

- [ ] Deploy to production
- [ ] Test critical flows (signup, create WU, run gate)
- [ ] Publish blog post
- [ ] Post on social media (Twitter, LinkedIn, Reddit)
- [ ] Submit to product directories (Product Hunt, Hacker News)
- [ ] Monitor errors (Sentry dashboard)
- [ ] Monitor performance (Vercel Analytics)
- [ ] Respond to user feedback

---

**Next Document**: [06-agent-starting-prompt.md](06-agent-starting-prompt.md)
