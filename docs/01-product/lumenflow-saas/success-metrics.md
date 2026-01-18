# LumenFlow SaaS - Success Metrics

**Document**: Appendix C
**Version**: 1.0
**Last Updated**: 2025-10-16

---

## 📊 Metrics Overview

LumenFlow tracks three categories of metrics:

1. **Product Metrics** - How users engage with the platform
2. **Business Metrics** - Revenue, growth, retention
3. **Technical Metrics** - Performance, reliability, quality

---

## 🎯 Product Metrics

### Activation Metrics

**Definition**: Activation = User reaches "aha moment" (completes first WU)

| Metric                       | Target      | Measurement                                      |
| ---------------------------- | ----------- | ------------------------------------------------ |
| **Activation Rate**          | 40%+        | % of signups who complete first WU within 7 days |
| **Time to First WU**         | <30 minutes | Median time from signup to first WU created      |
| **Time to First Completion** | <2 hours    | Median time from signup to first WU completed    |
| **Onboarding Completion**    | 60%+        | % of users who complete onboarding checklist     |

**Onboarding Checklist**:

1. ✅ Create account (magic link or OAuth)
2. ✅ Create team
3. ✅ Create first WU
4. ✅ Claim WU
5. ✅ Run first gate
6. ✅ Complete WU

**Why These Targets?**

- Industry average activation: 20-30% (we aim for 40%+ due to clear value prop)
- Faster activation = higher retention

**Tracking**:

```typescript
// Log activation event
analytics.track('user_activated', {
  user_id: user.id,
  team_id: team.id,
  days_since_signup: daysSinceSignup,
  wus_completed: 1,
});
```

---

### Engagement Metrics

**Definition**: Engagement = Active usage of core features

| Metric                   | Target          | Measurement                                       |
| ------------------------ | --------------- | ------------------------------------------------- |
| **DAU/MAU Ratio**        | 30%+            | Daily Active Users / Monthly Active Users         |
| **Weekly Active Users**  | 60%+ of signups | % of users active in past 7 days                  |
| **WUs Created per Team** | 20+/month       | Median WUs created per team per month             |
| **Gates Run per WU**     | 2+/WU           | Average gates run per WU                          |
| **Comments per WU**      | 1.5+/WU         | Average comments per WU (collaboration indicator) |
| **Session Duration**     | 15+ minutes     | Median session duration (web + mobile)            |
| **Sessions per Week**    | 5+/user         | Average sessions per user per week                |

**Why DAU/MAU = 30%?**

- Industry benchmark: 20-30% (SaaS productivity tools)
- LumenFlow is daily workflow tool → should be higher than average
- Linear (competitor) reports 35-40% DAU/MAU

**Tracking**:

```typescript
// Log daily active user
analytics.track('user_active', {
  user_id: user.id,
  session_id: session.id,
  duration_seconds: sessionDuration,
  wus_viewed: wusViewed,
  wus_created: wusCreated,
  gates_run: gatesRun,
});
```

---

### Feature Adoption

**Definition**: % of users who use each feature

| Feature               | Target Adoption | Measurement                              |
| --------------------- | --------------- | ---------------------------------------- |
| **Kanban Board**      | 100%            | % of users who view Kanban at least once |
| **WU Creation**       | 80%             | % of users who create at least one WU    |
| **WU Claiming**       | 60%             | % of users who claim at least one WU     |
| **Gate Runner**       | 50%             | % of teams who run at least one gate     |
| **WU Validator**      | 30%             | % of teams with validator enabled        |
| **Metrics Dashboard** | 40%             | % of teams who view DORA metrics         |
| **Mobile App**        | 20%             | % of users who install mobile app        |
| **CLI**               | 10%             | % of users who use CLI                   |

**Power User Indicator**: Uses 5+ features → 90%+ retention

**Tracking**:

```typescript
// Log feature usage
analytics.track('feature_used', {
  user_id: user.id,
  feature_name: 'gate_runner',
  usage_count: 1,
});
```

---

### Retention Cohorts

**Definition**: % of users still active N days/weeks after signup

| Cohort                | Target | Measurement                             |
| --------------------- | ------ | --------------------------------------- |
| **Day 1 Retention**   | 50%+   | % of users active on day after signup   |
| **Week 1 Retention**  | 40%+   | % of users active 7 days after signup   |
| **Week 4 Retention**  | 30%+   | % of users active 30 days after signup  |
| **Month 3 Retention** | 25%+   | % of users active 90 days after signup  |
| **Month 6 Retention** | 20%+   | % of users active 180 days after signup |

**Retention Curve Target**:

```
Week 0: 100% (all signups)
Week 1: 40%
Week 2: 35%
Week 3: 32%
Week 4: 30%
Week 8: 28%
Week 12: 25%  ← Stabilizes here (long-term retention)
```

**Why These Targets?**

- Industry average: 20-30% retention after 90 days
- Product-led growth SaaS: 25-35% retention
- LumenFlow should be sticky (daily workflow tool) → 30%+ target

---

## 💰 Business Metrics

### Growth Metrics

| Metric                          | Target                                  | Measurement                                  |
| ------------------------------- | --------------------------------------- | -------------------------------------------- |
| **Signups**                     | 100/week (Month 1) → 500/week (Month 6) | Total new signups per week                   |
| **Signup Growth Rate**          | 20%+ MoM                                | Month-over-month signup growth               |
| **Viral Coefficient**           | 0.5+                                    | Avg new signups per existing user (virality) |
| **Activation Rate**             | 40%+                                    | % of signups who complete first WU           |
| **Free → Pro Conversion**       | 10%+                                    | % of free users who upgrade to Pro           |
| **Pro → Enterprise Conversion** | 5%+                                     | % of Pro teams who upgrade to Enterprise     |

**Viral Coefficient Breakdown**:

- Viral coefficient = (invites sent per user) × (invite acceptance rate)
- Target: 5 invites/user × 10% acceptance = 0.5 viral coefficient
- If >1.0 → viral growth (exponential)

**Tracking**:

```typescript
// Log signup source
analytics.track('user_signed_up', {
  user_id: user.id,
  source: 'product_hunt', // or 'organic', 'referral', 'paid_ad'
  referrer_id: referrerId, // if referred by existing user
});
```

---

### Revenue Metrics

| Metric              | Target                              | Measurement                     |
| ------------------- | ----------------------------------- | ------------------------------- |
| **MRR**             | £26k (break-even) → £50k (Month 12) | Monthly Recurring Revenue       |
| **MRR Growth Rate** | 20%+ MoM                            | Month-over-month MRR growth     |
| **ARR**             | £600k (Year 1)                      | Annual Recurring Revenue        |
| **ARPU**            | £200+/team                          | Average Revenue Per User (team) |
| **LTV**             | £5,000+ (Pro), £350k+ (Enterprise)  | Lifetime Value                  |
| **CAC**             | <£250 (Pro), <£5,000 (Enterprise)   | Customer Acquisition Cost       |
| **LTV:CAC Ratio**   | 3:1+                                | LTV divided by CAC              |
| **Payback Period**  | <12 months                          | Time to recover CAC             |

**MRR Waterfall** (track month-over-month changes):

```
Starting MRR: £20,000
+ New MRR:     £8,000  (new customers)
+ Expansion:   £2,000  (upgrades, seat additions)
- Contraction: £500    (downgrades, seat removals)
- Churn:       £1,000  (cancelled subscriptions)
= Ending MRR:  £28,500
```

**Net New MRR**: £8,500 (29% growth)

**Tracking**:

```typescript
// Log subscription event
analytics.track('subscription_created', {
  team_id: team.id,
  tier: 'pro',
  seats: 8,
  mrr: 232, // £29 × 8 seats
  source: 'upgrade', // or 'new_customer'
});
```

---

### Retention & Churn Metrics

| Metric                      | Target                                                       | Measurement                                            |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| **Logo Churn**              | <5%/month (Free), <3%/month (Pro), <1%/month (Enterprise)    | % of customers who cancel                              |
| **Revenue Churn**           | <5%/month                                                    | % of MRR lost to churn                                 |
| **Net Revenue Retention**   | 110%+                                                        | MRR growth from existing customers (expansion - churn) |
| **Gross Revenue Retention** | 90%+                                                         | Revenue retention without expansion                    |
| **Customer Lifetime**       | 12+ months (Free), 24+ months (Pro), 48+ months (Enterprise) | Average months a customer stays                        |

**Churn Reasons** (track via exit survey):

- Price too high (target: <20% of churn)
- Missing features (target: <30%)
- Poor performance (target: <10%)
- Switched to competitor (target: <20%)
- No longer needed (target: <20%)

**Net Revenue Retention Calculation**:

```
Starting MRR (existing customers): £20,000
+ Expansion (upgrades, seats):      £2,000
- Churn (cancellations):            £1,000
- Contraction (downgrades):         £500
= Ending MRR:                       £20,500

NRR = £20,500 / £20,000 = 102.5%
```

Target: 110%+ (means expansion > churn)

---

### Unit Economics

| Metric             | Target                             | Measurement                                 |
| ------------------ | ---------------------------------- | ------------------------------------------- |
| **CAC**            | <£250 (Pro), <£5,000 (Enterprise)  | Total sales/marketing spend ÷ new customers |
| **LTV**            | £5,000+ (Pro), £350k+ (Enterprise) | ARPU × gross margin × customer lifetime     |
| **LTV:CAC Ratio**  | 3:1+                               | LTV ÷ CAC                                   |
| **Payback Period** | <12 months                         | CAC ÷ (ARPU × gross margin)                 |
| **Gross Margin**   | 90%+                               | (Revenue - COGS) ÷ Revenue                  |

**CAC Breakdown** (Pro customer):

```
Monthly marketing spend: £10,000
New signups: 400
Signups → Pro conversion: 10%
New Pro customers: 40

CAC = £10,000 / 40 = £250
```

**LTV Calculation** (Pro customer):

```
ARPU: £232/month (£29 × 8 seats)
Gross margin: 95%
Customer lifetime: 24 months

LTV = £232 × 0.95 × 24 = £5,284
```

**LTV:CAC = £5,284 / £250 = 21:1** ✅ (healthy)

---

## 🔧 Technical Metrics

### Performance Metrics

| Metric                             | Target       | Measurement           |
| ---------------------------------- | ------------ | --------------------- |
| **Page Load Time**                 | <2 seconds   | P95 (95th percentile) |
| **API Response Time**              | <500ms       | P95 (95th percentile) |
| **Time to Interactive (TTI)**      | <3 seconds   | Lighthouse metric     |
| **First Contentful Paint (FCP)**   | <1.5 seconds | Lighthouse metric     |
| **Cumulative Layout Shift (CLS)**  | <0.1         | Lighthouse metric     |
| **Largest Contentful Paint (LCP)** | <2.5 seconds | Lighthouse metric     |

**Web Vitals Targets** (Google's Core Web Vitals):

- LCP <2.5s ✅
- FID <100ms ✅
- CLS <0.1 ✅

**Tracking**: Vercel Analytics (built-in), Lighthouse CI

---

### Reliability Metrics

| Metric                  | Target                          | Measurement                        |
| ----------------------- | ------------------------------- | ---------------------------------- |
| **Uptime**              | 99.5% (Pro), 99.9% (Enterprise) | % of time service is available     |
| **Error Rate**          | <0.1%                           | % of requests that result in error |
| **Crash Rate** (mobile) | <0.5%                           | % of sessions that crash           |
| **Failed API Calls**    | <1%                             | % of API calls that return 5xx     |
| **Database Latency**    | <100ms                          | P95 query response time            |

**Uptime Calculation**:

- 99.5% = 3.6 hours downtime/month
- 99.9% = 43 minutes downtime/month

**Tracking**: UptimeRobot (ping every 5 minutes), Sentry (errors), Axiom (logs)

---

### Quality Metrics (DORA)

**DORA Metrics** (DevOps Research and Assessment):

| Metric                           | Target                   | Measurement                              |
| -------------------------------- | ------------------------ | ---------------------------------------- |
| **Deployment Frequency**         | Multiple deploys per day | How often code is deployed to production |
| **Lead Time for Changes**        | <1 day                   | Time from commit to production           |
| **Mean Time to Recovery (MTTR)** | <1 hour                  | Time to recover from failure             |
| **Change Failure Rate**          | <15%                     | % of deploys that cause failure          |

**DORA Levels**:

- **Elite**: Deploy on demand, <1 hour lead time, <1 hour MTTR, <15% failure rate ✅ (our target)
- **High**: Daily deploys, <1 day lead time, <1 day MTTR, <15% failure rate
- **Medium**: Weekly deploys, <1 week lead time, <1 day MTTR, <30% failure rate
- **Low**: Monthly deploys, >1 month lead time, >1 week MTTR, >30% failure rate

**LumenFlow's DORA** (also tracked for customers):

- Our own metrics (how we build LumenFlow)
- Customer metrics (how customers use LumenFlow)

---

### Test Coverage

| Metric                  | Target              | Measurement                                 |
| ----------------------- | ------------------- | ------------------------------------------- |
| **Unit Test Coverage**  | 90%+                | % of code covered by unit tests (Vitest)    |
| **E2E Test Coverage**   | 80%+ critical flows | % of user flows with E2E tests (Playwright) |
| **Test Execution Time** | <5 minutes          | Time to run full test suite                 |
| **Flaky Test Rate**     | <5%                 | % of tests that fail intermittently         |

**Critical Flows to E2E Test**:

1. Signup + login
2. Create WU
3. Claim WU
4. Run gate
5. Complete WU
6. Upgrade to Pro
7. View metrics
8. Invite team member

---

## 📈 North Star Metric

**Definition**: The single metric that best captures the value LumenFlow delivers

**LumenFlow's North Star**: **Active Work Units Completed per Team per Week**

**Why This Metric?**

- Measures **core value**: Teams complete work faster with LumenFlow
- Correlates with **retention**: Teams completing more WUs stay longer
- Correlates with **expansion**: Teams completing more WUs upgrade to Pro/Enterprise
- **Leading indicator**: Predicts revenue growth

**Target**:

- Free tier: 2+ WUs/week (low engagement, likely to churn)
- Pro tier: 10+ WUs/week (healthy engagement)
- Enterprise tier: 50+ WUs/week (power users)

**Tracking**:

```typescript
// Log WU completion
analytics.track('wu_completed', {
  wu_id: wu.id,
  team_id: wu.team_id,
  assigned_to: wu.assigned_to,
  claimed_at: wu.claimed_at,
  completed_at: wu.completed_at,
  lead_time_hours: leadTimeHours,
});
```

---

## 🎯 Metrics Dashboard

### Founder Dashboard (Daily Review)

**Top-Level KPIs**:

- MRR (current, growth %)
- ARR run rate
- Signups (today, this week, this month)
- Active users (DAU, MAU, DAU/MAU ratio)
- North Star Metric (WUs completed this week)
- Uptime (current, last 7 days)
- Critical errors (Sentry, last 24 hours)

**Weekly Review**:

- Activation rate
- Retention cohorts (D1, W1, W4)
- Free → Pro conversion rate
- Churn rate
- CAC, LTV, LTV:CAC
- DORA metrics

**Monthly Review**:

- MRR waterfall (new, expansion, contraction, churn)
- Net Revenue Retention (NRR)
- Feature adoption rates
- Customer interviews (5-10/month)
- Roadmap prioritization

---

### Customer Dashboard (Public Metrics)

**What customers see** (in their own dashboard):

**DORA Metrics**:

- Deployment Frequency (WUs completed per week)
- Lead Time (time from claimed → completed)
- Mean Time to Recovery (time to fix failed WUs)
- Change Failure Rate (% of WUs with failed gates)

**SPACE Metrics**:

- Satisfaction (team surveys, coming soon)
- Performance (DORA metrics)
- Activity (commits, PRs, comments per WU)
- Communication (comments per WU, response time)
- Efficiency (WUs completed per sprint)

**Team Health**:

- WU velocity trend (last 12 weeks)
- Gate pass rate
- WU validator pass rate
- Team collaboration (comments, mentions)

---

## 📊 Analytics Stack

| Tool                   | Purpose                                             | Cost                        |
| ---------------------- | --------------------------------------------------- | --------------------------- |
| **Vercel Analytics**   | Web Vitals, Real User Monitoring                    | Free (included with Vercel) |
| **PostHog**            | Product analytics (funnels, cohorts, feature flags) | Free (1M events/month)      |
| **Sentry**             | Error tracking, session replay                      | £26/month (Team plan)       |
| **Axiom**              | Log aggregation, queries                            | Free (500GB/month)          |
| **Stripe Dashboard**   | Revenue, MRR, churn                                 | Free (built-in)             |
| **Supabase Dashboard** | Database queries, table growth                      | Free (built-in)             |

**Why PostHog?**

- Open-source (can self-host if needed)
- Privacy-friendly (GDPR compliant)
- All-in-one (product analytics + feature flags + A/B testing)
- Free tier generous (1M events/month = ~10k users)

**Alternative Considered**: Mixpanel (£25/month, less generous free tier)

---

## 🎯 Success Criteria by Stage

### MVP Launch (Month 1)

- [ ] 100+ signups
- [ ] 40%+ activation rate
- [ ] 10+ Pro customers (£2,000+ MRR)
- [ ] 30%+ Day 1 retention
- [ ] 99%+ uptime
- [ ] <0.5% error rate
- [ ] Lighthouse score >90

### Product-Market Fit (Month 6)

- [ ] 1,000+ signups
- [ ] 50+ Pro customers (£12,000+ MRR)
- [ ] 3+ Enterprise customers (£25,000+ MRR)
- [ ] 30%+ Week 4 retention
- [ ] 10%+ Free → Pro conversion
- [ ] 3:1+ LTV:CAC ratio
- [ ] 50+ GitHub stars (open-source CLI)

### Scale (Month 12)

- [ ] 3,000+ signups
- [ ] 150+ Pro customers (£35,000+ MRR)
- [ ] 10+ Enterprise customers (£75,000+ MRR)
- [ ] 25%+ Month 3 retention
- [ ] £50k+ MRR (£600k ARR run rate)
- [ ] 110%+ Net Revenue Retention
- [ ] 500+ GitHub stars

### Growth (Year 2)

- [ ] 18,000+ signups
- [ ] 900+ Pro customers (£200k+ MRR)
- [ ] 60+ Enterprise customers (£600k+ MRR)
- [ ] £800k+ MRR (£9.6M ARR run rate)
- [ ] 120%+ Net Revenue Retention
- [ ] <3% monthly churn
- [ ] Series A funding (£8-15M)

---

## 🚀 Metrics to Avoid (Vanity Metrics)

**Don't Track**:

- Total signups (without activation)
- Page views (without engagement)
- Social media followers (without conversions)
- Press mentions (without signups)
- Email list size (without open rates)

**Why?**

- These metrics don't correlate with revenue or retention
- Easy to game (buy followers, fake traffic)
- Distract from actionable metrics

**Instead Track**:

- Activated users (completed first WU)
- Engaged users (active in last 7 days)
- Paying customers (MRR, retention)
- Customer feedback (NPS, interviews)

---

## 📞 Contact

**Questions about metrics**: metrics@lumenflow.app
**Request access to dashboard**: founders@lumenflow.app

---

**End of Success Metrics**
