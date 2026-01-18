# LumenFlow SaaS - Architecture & Tech Stack

**Document**: 02 of 06
**Version**: 1.0
**Last Updated**: 2025-10-16

---

## 🏗️ Architecture Overview

LumenFlow is a **multi-tenant SaaS platform** consisting of four main components:

1. **Web Dashboard** (lumenflow.app) - Primary user interface
2. **Mobile Apps** (iOS + Android) - Native mobile experience
3. **CLI Client** (npm package) - Terminal workflow interface
4. **Backend API** (hosted) - Central business logic + data layer

All components communicate with a single hosted API backed by Supabase (PostgreSQL + Auth + Realtime + Storage).

---

## 📊 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENTS                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Web Dashboard│  │ Mobile Apps  │  │ CLI Client   │      │
│  │ (Next.js 15) │  │ (Expo/RN)    │  │ (Node.js)    │      │
│  │              │  │              │  │              │      │
│  │ React 19     │  │ React Native │  │ Thin Client  │      │
│  │ Tailwind v4  │  │ Tamagui      │  │ Commander.js │      │
│  │ shadcn/ui    │  │ Expo Router  │  │ Chalk        │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          │ HTTPS (tRPC)     │ HTTPS (tRPC)     │ HTTPS (tRPC)
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      API LAYER                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │          Next.js API Routes (Edge Runtime)            │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │            tRPC Routers                       │    │  │
│  │  ├──────────────────────────────────────────────┤    │  │
│  │  │ • auth.router.ts   (signup, login, logout)   │    │  │
│  │  │ • teams.router.ts  (CRUD, members, billing)  │    │  │
│  │  │ • wus.router.ts    (CRUD, lifecycle, gates)  │    │  │
│  │  │ • gates.router.ts  (run, status, results)    │    │  │
│  │  │ • metrics.router.ts (DORA, SPACE, analytics) │    │  │
│  │  │ • billing.router.ts (Stripe webhooks, subs)  │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Business Logic Layer                   │  │
│  │                                                         │  │
│  │  • WU Validator (TODO/Mock/LLM detection)             │  │
│  │  • Gate Runner (lint, test, security scans)           │  │
│  │  • Metrics Calculator (DORA/SPACE aggregation)        │  │
│  │  • Billing Manager (Stripe subscription logic)        │  │
│  │  • Notification Engine (email, Slack, webhooks)       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────┬─────────────────────────────────────────────┬─┘
              │                                             │
              │                                             │
              ▼                                             ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│      SUPABASE PLATFORM       │     │    EXTERNAL SERVICES         │
├──────────────────────────────┤     ├──────────────────────────────┤
│                              │     │                              │
│  ┌────────────────────────┐ │     │  ┌────────────────────────┐ │
│  │   PostgreSQL Database  │ │     │  │   Stripe (Payments)    │ │
│  │   (Multi-tenant RLS)   │ │     │  └────────────────────────┘ │
│  └────────────────────────┘ │     │                              │
│                              │     │  ┌────────────────────────┐ │
│  ┌────────────────────────┐ │     │  │   Sentry (Error Logs)  │ │
│  │   Auth (JWT + OAuth)   │ │     │  └────────────────────────┘ │
│  └────────────────────────┘ │     │                              │
│                              │     │  ┌────────────────────────┐ │
│  ┌────────────────────────┐ │     │  │   Axiom (Observability)│ │
│  │   Realtime (WebSocket) │ │     │  └────────────────────────┘ │
│  └────────────────────────┘ │     │                              │
│                              │     │  ┌────────────────────────┐ │
│  ┌────────────────────────┐ │     │  │   Resend (Email)       │ │
│  │   Storage (Files)      │ │     │  └────────────────────────┘ │
│  └────────────────────────┘ │     │                              │
│                              │     │  ┌────────────────────────┐ │
└──────────────────────────────┘     │  │   GitHub API (OAuth)   │ │
                                     │  └────────────────────────┘ │
                                     │                              │
                                     └──────────────────────────────┘
```

---

## 🎯 Multi-Tenant Architecture

**Tenant Isolation Model**: Row-Level Security (RLS)

All data is stored in a single Supabase PostgreSQL database with RLS policies enforcing tenant boundaries.

### Key Principles

1. **Every table has `team_id`** (foreign key to `teams` table)
2. **RLS policies filter by `team_id`** (users can only see data for their teams)
3. **JWT contains `user_id`** (Supabase Auth manages sessions)
4. **User-Team mapping** (`team_members` junction table with roles)

### Example RLS Policy

```sql
-- Only allow users to see WUs for teams they belong to
CREATE POLICY "Users can view WUs for their teams"
ON work_units
FOR SELECT
USING (
  team_id IN (
    SELECT team_id
    FROM team_members
    WHERE user_id = auth.uid()
  )
);
```

**Why This Approach?**

- ✅ **Simple**: No complex tenant routing logic
- ✅ **Secure**: Enforced at database level (can't bypass with buggy code)
- ✅ **Performant**: PostgreSQL indexes on `team_id` make filtering fast
- ✅ **Cost-Effective**: Single database instance for all tenants
- ⚠️ **Scalability Limit**: Works well up to ~10,000 teams (then consider sharding)

---

## 🛠️ Tech Stack Decisions

### Frontend: Web Dashboard

**Stack**: Next.js 15 + React 19 + Tailwind v4 + shadcn/ui

**Why Next.js 15?**

- ✅ **App Router**: Modern routing with layouts, loading states, error boundaries
- ✅ **Server Components**: Reduce client-side JS, faster initial page loads
- ✅ **Streaming**: Progressive rendering (show UI before data fetching completes)
- ✅ **Edge Runtime**: Deploy API routes globally (low latency)
- ✅ **Vercel Integration**: Seamless deployment with zero config
- ✅ **TypeScript-first**: Excellent type inference for tRPC

**Why React 19?**

- ✅ **Server Actions**: Form submissions without client-side JS
- ✅ **Suspense Improvements**: Better async rendering
- ✅ **Concurrent Rendering**: Smoother UX (interrupting renders for urgent updates)

**Why Tailwind v4?**

- ✅ **Performance**: JIT compiler (only includes used classes)
- ✅ **Design System**: Reuse Beacon tokens (NHS blue, glassmorphism)
- ✅ **DX**: Fast iteration (no context switching to CSS files)
- ✅ **Accessibility**: Built-in focus states, ARIA utilities

**Why shadcn/ui?**

- ✅ **Copy-Paste Components**: No npm bloat (components live in our codebase)
- ✅ **Radix UI Primitives**: Accessible, keyboard navigable, WAI-ARIA compliant
- ✅ **Customizable**: Full control over styling (Tailwind classes)
- ✅ **Glassmorphism-Ready**: Easy to apply Beacon design tokens

**Alternative Considered**: Remix

- ❌ **Less Mature**: Newer framework, smaller ecosystem
- ❌ **No Edge Runtime**: Requires Node.js server (higher latency)
- ❌ **Vercel**: Next.js has better Vercel integration (instant deploys)

---

### Frontend: Mobile Apps

**Stack**: Expo + React Native + Tamagui + Expo Router

**Why Expo?**

- ✅ **Code Reuse**: Share business logic with web (tRPC clients, types)
- ✅ **Fast Iteration**: Expo Go app for instant testing on device
- ✅ **OTA Updates**: Push updates without App Store review
- ✅ **Native APIs**: Camera, push notifications, biometrics out of the box
- ✅ **EAS Build**: Managed build service (no need for Xcode/Android Studio locally)

**Why React Native?**

- ✅ **Hiring**: Large talent pool (React developers can write mobile)
- ✅ **Community**: Mature ecosystem (libraries for everything)
- ✅ **Performance**: Native components (not WebView like Ionic)

**Why Tamagui?**

- ✅ **Performance**: Optimizes to native views (60fps animations)
- ✅ **Shared Styles**: Use same design tokens as web (Tailwind-like API)
- ✅ **Responsive**: Media queries work across web + mobile
- ✅ **Glassmorphism**: Supports backdrop blur on iOS/Android

**Why Expo Router?**

- ✅ **File-Based Routing**: Same as Next.js App Router (easy mental model)
- ✅ **Deep Linking**: Automatic URL handling (lumenflow://wu/123)
- ✅ **Type-Safe**: Auto-generated route types

**Alternative Considered**: Flutter

- ❌ **Different Language**: Dart (can't reuse TypeScript/React knowledge)
- ❌ **Larger Binary**: Flutter apps are 20-30MB larger than RN
- ❌ **Less JS Ecosystem**: Can't reuse npm packages

---

### Backend: API Layer

**Stack**: tRPC + Next.js API Routes + Zod

**Why tRPC?**

- ✅ **Type Safety**: End-to-end types from server → client (no code gen)
- ✅ **Auto-Complete**: IDE suggests available procedures + params
- ✅ **No Schema Files**: Types inferred directly from code
- ✅ **React Query Integration**: Built-in caching, optimistic updates
- ✅ **Lightweight**: ~10KB gzipped (vs GraphQL 50KB+)

**Example tRPC Procedure**:

```typescript
// server/routers/wus.ts
export const wusRouter = router({
  claim: protectedProcedure
    .input(z.object({ wuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('work_units')
        .update({ status: 'in_progress', assigned_to: ctx.user.id })
        .eq('id', input.wuId)
        .single();

      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      return data;
    }),
});

// client usage (web or mobile)
const claimMutation = trpc.wus.claim.useMutation();
await claimMutation.mutateAsync({ wuId: 'WU-123' });
```

**Why Not GraphQL?**

- ❌ **Complexity**: Requires schema definitions, resolvers, code generation
- ❌ **Overhead**: GraphQL runtime is ~50KB (tRPC is 10KB)
- ❌ **Overkill**: We don't need flexible querying (clients always fetch same data)

**Why Not REST?**

- ❌ **No Type Safety**: Manual type definitions drift from API
- ❌ **Documentation Burden**: Need to maintain OpenAPI specs
- ❌ **Version Hell**: /v1, /v2 endpoints proliferate

**Why Zod?**

- ✅ **Runtime Validation**: Parse user input + validate at runtime
- ✅ **TypeScript Inference**: Auto-generates types from schemas
- ✅ **Error Messages**: Human-readable validation errors
- ✅ **Composable**: Reuse schemas across endpoints

---

### Backend: Database + Auth

**Stack**: Supabase (PostgreSQL + Auth + Realtime + Storage)

**Why Supabase?**

- ✅ **All-in-One**: Database + Auth + Realtime + Storage + Functions
- ✅ **PostgreSQL**: Battle-tested, ACID compliant, rich ecosystem
- ✅ **Row-Level Security**: Built-in tenant isolation (see Multi-Tenant section)
- ✅ **Auto-Generated APIs**: REST + GraphQL + Realtime subscriptions
- ✅ **TypeScript Types**: Auto-generate types from schema
- ✅ **Self-Hostable**: Can migrate to self-hosted if needed (exit strategy)

**Why Not Firebase?**

- ❌ **NoSQL**: Document-based (harder to model relational data like WUs ↔ Teams)
- ❌ **Vendor Lock-In**: Proprietary (can't self-host)
- ❌ **Cost**: More expensive at scale (per-read billing)

**Why Not AWS RDS + Cognito?**

- ❌ **Complexity**: Need to wire up auth + database + API separately
- ❌ **No Realtime**: Would need to add WebSocket server (Socket.io, Ably)
- ❌ **Slower Development**: More boilerplate code

**Supabase Auth Features Used**:

- Magic links (passwordless login)
- OAuth (GitHub, Google, Microsoft)
- JWT tokens (stored in httpOnly cookies)
- Refresh tokens (auto-renewal)
- Email verification
- SSO/SAML (Enterprise tier, via Supabase partners)

**Supabase Realtime Features Used**:

- Live backlog updates (when teammate claims WU, others see it immediately)
- Activity feed (see who's working on what in real-time)
- Notification toasts (gate failures, WU transitions)

**Supabase Storage Features Used**:

- WU attachments (screenshots, diagrams, test results)
- Team avatars
- File uploads with presigned URLs (secure, temporary access)

---

### Backend: Payments

**Stack**: Stripe

**Why Stripe?**

- ✅ **Industry Standard**: Most trusted payment processor for SaaS
- ✅ **Subscription Management**: Built-in recurring billing, prorations, trials
- ✅ **Webhooks**: Real-time events (subscription.created, payment_failed)
- ✅ **Customer Portal**: Self-service billing management (cancel, update card)
- ✅ **Tax Compliance**: Automatic VAT/sales tax calculation
- ✅ **Strong SCA**: Built-in 3D Secure for EU compliance

**Stripe Integration Points**:

1. **Checkout**: Redirect to Stripe Checkout for payment
2. **Webhooks**: Listen for subscription lifecycle events
3. **Customer Portal**: Link from settings page for users to manage billing
4. **Usage Reporting**: Report seat count for per-seat billing

**Alternative Considered**: Paddle

- ❌ **Less Flexible**: Merchant of record (we don't own customer data)
- ❌ **Higher Fees**: 5% + payment processing (Stripe is 2.9% + 30p)

---

### Hosting + Infrastructure

**Stack**: Vercel + Supabase Cloud + GitHub Actions

**Why Vercel?**

- ✅ **Next.js Optimized**: Built by same team, best performance
- ✅ **Edge Functions**: Deploy API routes globally (low latency)
- ✅ **Instant Deploys**: Git push → production in <1 min
- ✅ **Preview Environments**: Every PR gets unique URL
- ✅ **Analytics**: Built-in Web Vitals, Real User Monitoring
- ✅ **DDoS Protection**: Automatic rate limiting, firewall

**Environments**:

- **Development**: `localhost:3000` (local Supabase via Docker)
- **Staging**: `staging.lumenflow.app` (Vercel preview, separate Supabase project)
- **Production**: `lumenflow.app` (Vercel production, Supabase production)

**Why Not AWS/GCP/Azure?**

- ❌ **Complexity**: Need to manage VMs, load balancers, auto-scaling
- ❌ **Slower Deploys**: CI/CD takes 10-20 minutes (Vercel is <1 min)
- ❌ **No Edge**: Would need CloudFront/Cloudflare separately

**Why Not Railway/Render?**

- ❌ **Less Mature**: Newer platforms, smaller community
- ❌ **No Edge**: Single-region deployment (higher latency)

---

### Monitoring + Observability

**Stack**: Sentry + Axiom + Vercel Analytics

**Why Sentry?**

- ✅ **Error Tracking**: Captures exceptions with stack traces
- ✅ **Session Replay**: See what user did before error
- ✅ **Performance Monitoring**: Tracks slow API calls, page loads
- ✅ **Release Tracking**: Correlate errors to deployments

**Why Axiom?**

- ✅ **Log Aggregation**: Structured logs from Next.js + tRPC
- ✅ **Fast Search**: Query 1TB of logs in seconds
- ✅ **Generous Free Tier**: 500GB/month free (vs Datadog $15/GB)
- ✅ **Traces**: Distributed tracing across API routes

**Why Vercel Analytics?**

- ✅ **Web Vitals**: LCP, FID, CLS tracking
- ✅ **Real User Monitoring**: Actual user performance data
- ✅ **Zero Config**: Built into Vercel (no SDK needed)

**Alternative Considered**: Datadog

- ❌ **Expensive**: $15-31/host/month + $15/GB logs
- ❌ **Overkill**: We don't need APM for 100+ microservices

---

### CI/CD + Testing

**Stack**: GitHub Actions + Vitest + Playwright

**Why GitHub Actions?**

- ✅ **Integrated**: Runs on GitHub PRs (no external service)
- ✅ **Free**: 2,000 minutes/month for private repos
- ✅ **Matrix Builds**: Test on multiple Node versions, OSes

**CI Pipeline**:

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test # Vitest unit tests
      - run: pnpm test:e2e # Playwright E2E tests
      - run: pnpm build # Ensure production build succeeds
```

**Why Vitest?**

- ✅ **Fast**: Runs tests in parallel, hot module reloading
- ✅ **Jest-Compatible**: Same API, easy migration from Jest
- ✅ **ESM-First**: Native ES modules support (no Babel)
- ✅ **TypeScript**: First-class TS support (no ts-jest needed)

**Why Playwright?**

- ✅ **Cross-Browser**: Tests on Chrome, Firefox, Safari (WebKit)
- ✅ **Auto-Wait**: No manual `waitFor` (waits for elements automatically)
- ✅ **Trace Viewer**: Visual debugging (see screenshots, network, console)
- ✅ **Codegen**: Record tests by clicking in browser

**Alternative Considered**: Cypress

- ❌ **Slower**: Runs tests serially (Playwright parallelizes)
- ❌ **No Safari**: WebKit not supported
- ❌ **Flakier**: More frequent timeout issues

---

## 📦 Monorepo Structure

**Stack**: Turborepo + pnpm Workspaces

**Why Monorepo?**

- ✅ **Code Reuse**: Share types, utils, tRPC routers across web + mobile + CLI
- ✅ **Atomic Changes**: Update API + clients in single commit
- ✅ **Simplified Versioning**: No need to publish/consume internal packages

**Monorepo Layout**:

```
lumenflow-saas/
├── apps/
│   ├── web/              # Next.js web dashboard
│   ├── mobile/           # Expo mobile app
│   └── cli/              # Node.js CLI client
├── packages/
│   ├── api/              # tRPC routers + procedures
│   ├── db/               # Supabase schema + migrations
│   ├── ui/               # Shared UI components (React)
│   ├── config-eslint/    # ESLint config
│   └── config-typescript/ # TypeScript config
├── tooling/
│   ├── gates/            # Gate runner implementations
│   └── validators/       # WU validator logic
├── turbo.json            # Turborepo task pipeline
└── package.json          # Root package.json
```

**Why Turborepo?**

- ✅ **Caching**: Skips rebuilds if code hasn't changed
- ✅ **Parallel Execution**: Runs tasks across packages in parallel
- ✅ **Remote Caching**: Share cache across team (Vercel Remote Cache)

**Why pnpm?**

- ✅ **Disk Efficient**: Symlinks to global store (saves GB of space)
- ✅ **Faster**: Installs packages in parallel
- ✅ **Strict**: Prevents phantom dependencies

**Alternative Considered**: Nx

- ❌ **Complexity**: More features than we need (code generation, scaffolding)
- ❌ **Overhead**: ~100MB install size (Turborepo is ~10MB)

---

## 🔒 Security Architecture

### Authentication Flow

1. **User visits lumenflow.app**
2. **Click "Sign in with GitHub"** (OAuth)
3. **Supabase redirects to GitHub** (authorize app)
4. **GitHub redirects back with code**
5. **Supabase exchanges code for token** (stores in database)
6. **Supabase issues JWT** (signed, expires in 1 hour)
7. **Client stores JWT in httpOnly cookie** (XSS protection)
8. **Client includes cookie in API requests** (tRPC middleware validates)

### Authorization Model

**Roles** (per team):

- `owner` - Full control (billing, delete team, manage members)
- `admin` - Manage WUs, members (cannot delete team)
- `member` - Claim WUs, run gates (cannot manage members)

**RLS Policies** (see [03-data-model.md](03-data-model.md) for SQL):

- Users can only read/write data for teams they belong to
- Only owners can delete teams
- Only owners/admins can manage members
- Only owners can access billing

### Data Encryption

- **At Rest**: Supabase encrypts PostgreSQL with AES-256
- **In Transit**: All connections use TLS 1.3 (HTTPS, WSS)
- **Secrets**: Stored in Vercel environment variables (encrypted at rest)

### Rate Limiting

**Vercel Edge Functions**: Built-in DDoS protection
**Supabase**: 100 requests/second per IP (configurable)
**Stripe**: Webhook signature verification (prevent replay attacks)

**Custom Rate Limits** (implemented in tRPC middleware):

- Free tier: 100 API calls/minute
- Pro tier: 1,000 API calls/minute
- Enterprise: Unlimited (with burst protection)

---

## 🌍 Deployment Strategy

### Production Architecture

**Regions**:

- **Vercel**: Edge network (300+ locations globally)
- **Supabase**: Primary region: `eu-west-2` (London)
  - Replication: `us-east-1` (Virginia) for read replicas (Enterprise tier)

**Why London Primary?**

- ✅ **GDPR Compliance**: Data residency in EU
- ✅ **Latency**: Closest to UK users (target market)
- ✅ **Supabase Availability**: Best uptime SLA in eu-west-2

### Environments

| Environment     | URL                     | Supabase Project    | Purpose           |
| --------------- | ----------------------- | ------------------- | ----------------- |
| **Development** | `localhost:3000`        | Local (Docker)      | Local development |
| **Staging**     | `staging.lumenflow.app` | `lumenflow-staging` | QA testing, demos |
| **Production**  | `lumenflow.app`         | `lumenflow-prod`    | Live users        |

**Deployment Flow**:

1. Developer pushes to feature branch
2. Vercel creates preview deployment (`feat-x.lumenflow.app`)
3. GitHub Actions runs CI (tests, lint, build)
4. PR approved → merge to `main`
5. Vercel auto-deploys to production (atomic, zero-downtime)

### Database Migrations

**Tool**: Supabase CLI (`supabase db push`)

**Migration Flow**:

1. Developer writes migration in `packages/db/migrations/`
2. Test locally: `supabase db reset` (applies all migrations)
3. Commit migration file
4. CI runs migration against staging database
5. Manually run against production: `pnpm db:push --env production`

**Rollback Strategy**:

- Every migration has `up` and `down` SQL
- Rollback via `supabase db reset --version 20250115_123456`

---

## 📊 Scalability Considerations

### Current Capacity (MVP)

**Supabase Free Tier**:

- 500MB database storage
- 2GB bandwidth/month
- 50,000 monthly active users
- 500MB file storage

**Vercel Pro Tier** (£16/month):

- 100GB bandwidth/month
- 1,000 serverless function invocations/day
- Unlimited edge requests

**Cost at 500 Free Users**: ~£16/month (Vercel only, Supabase free)

### Growth Capacity

**At 1,000 Users (100 Paying)**:

- Supabase Pro: £20/month (8GB database, 50GB bandwidth)
- Vercel Pro: £16/month
- **Total Infra Cost**: £36/month → **Gross Margin**: 95%

**At 10,000 Users (1,000 Paying)**:

- Supabase Pro: £120/month (100GB database, 250GB bandwidth)
- Vercel Pro: £16/month (still within limits)
- **Total Infra Cost**: £136/month → **Gross Margin**: 94%

**At 100,000 Users (10,000 Paying)**:

- Supabase Team: £599/month (dedicated instance, 500GB database)
- Vercel Enterprise: £400/month (custom bandwidth)
- **Total Infra Cost**: £999/month → **Gross Margin**: 92%

### Scaling Bottlenecks

**Database** (first bottleneck at ~5,000 concurrent users):

- **Solution**: Supabase connection pooling (PgBouncer)
- **Next Step**: Read replicas (Enterprise tier users route to closest region)

**API** (first bottleneck at ~10,000 requests/second):

- **Solution**: Vercel Edge Functions auto-scale horizontally
- **Next Step**: Redis cache layer (Upstash) for hot data (DORA metrics)

**Realtime** (first bottleneck at ~1,000 concurrent WebSocket connections):

- **Solution**: Supabase Realtime scales to 10k connections
- **Next Step**: Partition channels by team (reduce broadcast overhead)

---

## 🎯 Tech Debt Prevention

### Code Quality Gates (Run in CI)

1. **TypeScript**: No `any` types allowed (`strict: true`)
2. **ESLint**: Enforce consistent code style
3. **Prettier**: Auto-format on save
4. **Vitest**: 90%+ test coverage required
5. **Playwright**: E2E tests for critical flows (signup, claim WU, run gates)

### Dependency Management

**Policy**: Auto-update dependencies weekly (Renovate bot)

- **Why**: Security patches, bug fixes, new features
- **Risk**: Breaking changes
- **Mitigation**: CI catches breakages before merge

**Exceptions** (pin major version):

- Next.js (wait for `.1` release, e.g., `15.1.0` not `15.0.0`)
- React (wait for community libraries to catch up)

---

## 🔄 Migration Path (If Needed)

**Exit Strategy**: LumenFlow is designed to be **portable** (not locked into Supabase/Vercel)

### If We Outgrow Supabase

**Migrate To**: Self-hosted PostgreSQL (RDS, Google Cloud SQL, Azure)

**Steps**:

1. Export Supabase schema → vanilla PostgreSQL
2. Replace Supabase Auth → Clerk or Auth0 (or roll own with Passport.js)
3. Replace Supabase Realtime → Socket.io or Pusher
4. Replace Supabase Storage → S3 or Cloudflare R2

**Effort**: ~2-4 weeks of engineering work

### If We Outgrow Vercel

**Migrate To**: AWS/GCP/Azure with Docker + Kubernetes

**Steps**:

1. Build Next.js app as Docker image (`next build && next start`)
2. Deploy to Kubernetes cluster
3. Replace Vercel Edge Functions → AWS Lambda@Edge or Cloudflare Workers

**Effort**: ~4-8 weeks of engineering work

**Why Not Plan for This Now?**

- ❌ **Premature Optimization**: We won't hit these limits until 10,000+ users
- ✅ **Focus on Product**: Better to validate PMF than build scalability we don't need

---

## 📚 Tech Stack Summary Table

| Layer                 | Technology            | License            | Cost (Production)          |
| --------------------- | --------------------- | ------------------ | -------------------------- |
| **Frontend (Web)**    | Next.js 15            | MIT                | Free                       |
| **Frontend (Mobile)** | Expo                  | MIT                | Free (EAS Build: £88/mo)   |
| **UI Library**        | shadcn/ui + Radix     | MIT                | Free                       |
| **Styling**           | Tailwind v4           | MIT                | Free                       |
| **API**               | tRPC                  | MIT                | Free                       |
| **Database**          | Supabase (PostgreSQL) | PostgreSQL License | £20-599/mo                 |
| **Auth**              | Supabase Auth         | Apache 2.0         | Included in Supabase       |
| **Realtime**          | Supabase Realtime     | Apache 2.0         | Included in Supabase       |
| **Storage**           | Supabase Storage      | Apache 2.0         | Included in Supabase       |
| **Payments**          | Stripe                | Proprietary        | 2.9% + 30p per transaction |
| **Hosting (Web)**     | Vercel                | Proprietary        | £16/mo (Pro)               |
| **Hosting (Mobile)**  | Expo EAS              | Proprietary        | £88/mo (Production plan)   |
| **Monitoring**        | Sentry                | BSD-3              | £26/mo (Team plan)         |
| **Logs**              | Axiom                 | Proprietary        | Free (500GB/mo)            |
| **Email**             | Resend                | Proprietary        | Free (3k emails/mo)        |
| **CLI**               | Commander.js          | MIT                | Free                       |

**Total Monthly Infra Cost (MVP)**: ~£150/mo

---

## 🎯 Next Steps

1. **Setup Monorepo** (WU-600, see [05-mvp-work-units.md](05-mvp-work-units.md))
2. **Create Supabase Project** (production + staging)
3. **Setup Vercel** (connect GitHub repo)
4. **Configure Stripe** (test mode + webhooks)
5. **Start Building** (WU-601: Authentication flow)

---

**Next Document**: [03-data-model.md](03-data-model.md)
