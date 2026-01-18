# LumenFlow SaaS - Complete Project Documentation

**Version**: 1.0
**Last Updated**: 2025-10-16
**Status**: Ready for Implementation

---

## 📖 What is LumenFlow SaaS?

LumenFlow is the **first AI-native workflow platform** designed specifically for engineering teams using AI pair programming tools (GitHub Copilot, Claude Code, Cursor). It prevents incomplete work, enforces quality gates, and tracks team velocity through DORA/SPACE metrics.

**Architecture**: Multi-tenant SaaS platform with:

- **Web Dashboard** (responsive, real-time collaboration)
- **Mobile App** (iOS + Android native via Expo)
- **CLI Client** (thin client talking to hosted API)

**Business Model**: Freemium SaaS

- Free: 3 members, 10 WUs, basic features
- Pro: £29/seat/month, unlimited members/WUs, advanced features
- Enterprise: £99/seat/month, SSO, compliance, dedicated support

---

## 🎯 Why SaaS vs Open Source?

We're building a **hosted platform** (not open-sourcing the tools) because:

✅ **Protects IP**: Workflow engine stays proprietary
✅ **Recurring Revenue**: Subscription from Day 1
✅ **Better UX**: Always-on sync, real-time updates
✅ **Easier Monetization**: Generous free tier without self-hosting friction
✅ **Multi-Tenant**: Scales to thousands of teams from start

---

## 📚 Documentation Structure

This documentation package is **complete and self-contained**. You can drop it into a new LumenFlow SaaS project and start building immediately.

### Core Documents (Read in Order)

1. **[01-vision-and-strategy.md](01-vision-and-strategy.md)**
   Product vision, market positioning, business model, success criteria

2. **[02-architecture-and-tech-stack.md](02-architecture-and-tech-stack.md)**
   Technical architecture, stack decisions (Next.js, Supabase, tRPC, etc.), infrastructure

3. **[03-data-model.md](03-data-model.md)**
   Complete database schema (Supabase/PostgreSQL), RLS policies, TypeScript types

4. **[04-design-system.md](04-design-system.md)**
   Visual language (glassmorphism), component library, accessibility requirements

5. **[05-mvp-work-units.md](05-mvp-work-units.md)**
   Complete specifications for MVP (WU-600 through WU-611 with full acceptance criteria)

6. **[06-agent-starting-prompt.md](06-agent-starting-prompt.md)**
   Starting prompt for AI agents (Claude Code, etc.) to begin building

### Appendix (Reference Material)

- **[appendix/revenue-model.md](appendix/revenue-model.md)**
  Pricing breakdown, cost structure, revenue projections, funding requirements

- **[appendix/security-compliance.md](appendix/security-compliance.md)**
  Security architecture, GDPR compliance, SOC 2 roadmap

- **[appendix/success-metrics.md](appendix/success-metrics.md)**
  Product metrics, technical health, user engagement, DORA/SPACE tracking

---

## 🚀 Quick Start Guide

### For Humans Starting a New Project

1. **Read the docs** (in order: 01 → 02 → 03 → 04 → 05 → 06)
2. **Setup new repo**: `git init lumenflow-saas && cd lumenflow-saas`
3. **Copy these docs**: `cp -r /path/to/docs/lumenflow-saas ./docs/`
4. **Follow WU-600**: Create monorepo structure (see [05-mvp-work-units.md](05-mvp-work-units.md))
5. **Setup Supabase**: Create project, run migrations (see [03-data-model.md](03-data-model.md))
6. **Start building**: Follow MVP work units sequentially

### For AI Agents

Read **[06-agent-starting-prompt.md](06-agent-starting-prompt.md)** for complete context and instructions on how to build LumenFlow SaaS from scratch.

---

## 🛠️ Tech Stack Summary

| Layer          | Technology                | Why                                      |
| -------------- | ------------------------- | ---------------------------------------- |
| **Web**        | Next.js 15 + React 19     | App Router, Server Components, streaming |
| **Mobile**     | Expo + React Native       | Code reuse with web, fast iteration      |
| **Styling**    | Tailwind v4 + shadcn/ui   | Proven, fast, accessible                 |
| **API**        | tRPC + Next.js API Routes | Type-safe, auto-generated clients        |
| **Database**   | Supabase (PostgreSQL)     | Auth + Realtime + Storage in one         |
| **Auth**       | Supabase Auth             | Magic links, OAuth, SSO ready            |
| **Payments**   | Stripe                    | Standard for SaaS billing                |
| **Hosting**    | Vercel                    | Edge Functions, auto-scaling             |
| **Monitoring** | Sentry + Axiom            | Errors + logs + traces                   |

See **[02-architecture-and-tech-stack.md](02-architecture-and-tech-stack.md)** for detailed rationale.

---

## 📊 MVP Scope

**12 Work Units** (WU-600 through WU-611) organized in **4 phases**:

### Phase 1: Foundation

- WU-600: Setup monorepo structure
- WU-601: Build authentication flow
- WU-602: Build core API (tRPC)

### Phase 2: Web Dashboard

- WU-603: Build landing page
- WU-604: Build dashboard home
- WU-605: Build backlog Kanban board

### Phase 3: Gates & Validation

- WU-606: Build WU validator engine
- WU-607: Build gate runner (cloud gates)
- WU-608: Build DORA metrics calculator

### Phase 4: Billing & Launch

- WU-609: Build Stripe integration
- WU-610: Build CLI client (thin client)
- WU-611: Launch prep & go-live

See **[05-mvp-work-units.md](05-mvp-work-units.md)** for full specifications.

---

## 🎨 Design Philosophy

**Reuse Beacon Design System** (from PatientPath):

- Liquid glass aesthetic (glassmorphism)
- NHS blue accents (#005EB8)
- Professional, minimal, accessible (WCAG 2.2 AA)

See **[04-design-system.md](04-design-system.md)** for complete visual language.

---

## 🎯 Success Criteria

### Launch Goals

- 500+ signups
- 50+ Pro conversions (£1,450 MRR)
- Product Hunt: Top 10 Product of the Day
- HN: Front page (6+ hours)

### Technical Health

- Uptime: ≥99.9%
- API p95 latency: <200ms
- Web Lighthouse score: ≥90
- Test coverage: ≥90%

See **[appendix/success-metrics.md](appendix/success-metrics.md)** for complete metrics.

---

## 🔐 Security & Compliance

**Day 1 Security**:

- Data encryption (at rest + in transit)
- JWT + refresh tokens (Supabase Auth)
- Row-level security (RLS) on all tables
- Rate limiting per team

**Enterprise** (Post-Launch):

- SSO/SAML (Okta, Azure AD)
- Audit logs (6-year retention)
- GDPR compliance
- SOC 2 certification at £500k ARR

See **[appendix/security-compliance.md](appendix/security-compliance.md)** for details.

---

## 💰 Revenue Model

### Pricing Tiers

| Tier           | Price       | Target       | Features                                            |
| -------------- | ----------- | ------------ | --------------------------------------------------- |
| **Free**       | £0          | 1-3 members  | 10 WUs, basic validator, GitHub only                |
| **Pro**        | £29/seat/mo | 5-50 members | Unlimited WUs, advanced validator, all integrations |
| **Enterprise** | £99/seat/mo | 50-500+      | SSO, audit logs, custom gates, CSM                  |

### Revenue Projections

- **Early**: 1,000 Free users, 100 Pro seats = £2.9k MRR
- **Growth**: 3,000 Free, 500 Pro, 2 Enterprise = £18.5k MRR
- **Scale**: 10,000 Free, 2,000 Pro, 10 Enterprise = £87.7k MRR → **£1M+ ARR**

See **[appendix/revenue-model.md](appendix/revenue-model.md)** for cost structure and funding.

---

## 🤝 Contributing

This documentation is the **single source of truth** for LumenFlow SaaS. When building:

1. **Follow the specs exactly** (don't deviate without updating docs)
2. **Use LumenFlow methodology** (WU lifecycle, TDD, gates must pass)
3. **Dogfood the product** (use LumenFlow to build LumenFlow)
4. **Update docs as you go** (keep them current)

---

## 📞 Questions?

If you have questions while building:

- **Architecture**: See [02-architecture-and-tech-stack.md](02-architecture-and-tech-stack.md)
- **Data Model**: See [03-data-model.md](03-data-model.md)
- **Design**: See [04-design-system.md](04-design-system.md)
- **WU Specs**: See [05-mvp-work-units.md](05-mvp-work-units.md)

---

## 🎬 Ready to Build?

Start by reading **[06-agent-starting-prompt.md](06-agent-starting-prompt.md)** for complete context, then begin with **WU-600** (Setup Monorepo Structure) in **[05-mvp-work-units.md](05-mvp-work-units.md)**.

**Let's build the future of AI-native workflows!** 🚀
