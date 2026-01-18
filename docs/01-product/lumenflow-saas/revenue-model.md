# LumenFlow SaaS - Revenue Model

**Document**: Appendix A
**Version**: 1.0
**Last Updated**: 2025-10-16

---

## 💰 Pricing Strategy

### Freemium Model

LumenFlow uses a **freemium SaaS model** with three tiers:

| Tier           | Price          | Target                       | Value Prop                         |
| -------------- | -------------- | ---------------------------- | ---------------------------------- |
| **Free**       | £0/month       | Individual devs, small teams | Get started, validate workflow     |
| **Pro**        | £29/seat/month | Growing teams (5-50 members) | Unlimited WUs, advanced features   |
| **Enterprise** | £99/seat/month | Large orgs (50+ members)     | SSO, compliance, dedicated support |

---

## 📊 Tier Comparison

| Feature               | Free              | Pro                          | Enterprise           |
| --------------------- | ----------------- | ---------------------------- | -------------------- |
| **Teams**             | 1                 | Unlimited                    | Unlimited            |
| **Team Members**      | 3                 | Unlimited                    | Unlimited            |
| **Active Work Units** | 10                | Unlimited                    | Unlimited            |
| **Metrics History**   | 30 days           | 1 year                       | Unlimited            |
| **Gates**             | Lint, Test        | + Security, Custom           | + Enterprise Gates   |
| **WU Validator**      | Basic (TODOs)     | Advanced (TODOs, Mocks, LLM) | + Custom Rules       |
| **Integrations**      | GitHub            | + GitLab, Bitbucket          | + JIRA, Linear       |
| **Auth**              | Magic Link, OAuth | +                            | + SSO/SAML           |
| **Support**           | Community         | Email (24h SLA)              | Dedicated CSM, Slack |
| **Data Retention**    | 90 days           | 1 year                       | Unlimited            |
| **Compliance**        | -                 | -                            | SOC 2, HIPAA         |
| **SLA**               | -                 | 99.5% uptime                 | 99.9% uptime         |

---

## 💵 Pricing Psychology

### Why £29 for Pro?

**Anchored to competitors**:

- Linear: £8/seat/mo (but less features)
- Jira: £7-14/seat/mo (complex, legacy)
- Asana: £10.99/seat/mo (not dev-focused)
- **LumenFlow**: £29/seat/mo (AI-native, workflow automation)

**Value Justification**:

- Saves **2-4 hours/week per dev** (incomplete work prevention)
- **£50/hour dev rate** → £100-200/week saved → **£400-800/month ROI**
- **£29 is 4% of ROI** → easy sell

### Why £99 for Enterprise?

**Enterprise features cost more to build + support**:

- SSO/SAML integration: £20k+ dev cost
- SOC 2 compliance: £50k+ audit cost
- Dedicated CSM: £50k/year salary

**Competitive Landscape**:

- Linear Enterprise: Custom pricing (~£50-100/seat)
- Jira Enterprise: £13-16/seat (but 50 seat minimum)
- **LumenFlow**: £99/seat (transparent, no negotiation)

**Target**: 50+ seat orgs → £4,950+/month per customer → £59k+/year ARR

---

## 📈 Revenue Projections

### Year 1 (MVP Launch)

**Assumptions**:

- Launch with 0 users
- Conversion funnel: 1000 signups → 100 Pro (10%) → 5 Enterprise (0.5%)
- Avg team size: 8 members (Pro), 75 members (Enterprise)
- Churn: 5%/month (Pro), 2%/month (Enterprise)

| Month  | Free Users | Pro Teams | Pro Seats | Enterprise | MRR      | ARR Run Rate |
| ------ | ---------- | --------- | --------- | ---------- | -------- | ------------ |
| **1**  | 50         | 2         | 16        | 0          | £464     | £5.6k        |
| **2**  | 150        | 6         | 48        | 0          | £1,392   | £16.7k       |
| **3**  | 300        | 12        | 96        | 1          | £10,209  | £122.5k      |
| **6**  | 1,000      | 50        | 400       | 3          | £33,825  | £405.9k      |
| **12** | 3,000      | 150       | 1,200     | 10         | £109,200 | £1.31M       |

**Year 1 Total Revenue**: ~£500k

### Year 2 (Growth)

**Assumptions**:

- Accelerated signup growth (word-of-mouth, Product Hunt, conferences)
- Better conversion (improved onboarding, feature parity with competitors)
- Lower churn (product-market fit achieved)

| Quarter | Free Users | Pro Teams | Pro Seats | Enterprise | MRR      | ARR Run Rate |
| ------- | ---------- | --------- | --------- | ---------- | -------- | ------------ |
| **Q1**  | 5,000      | 250       | 2,000     | 15         | £206,850 | £2.48M       |
| **Q2**  | 8,000      | 400       | 3,200     | 25         | £343,500 | £4.12M       |
| **Q3**  | 12,000     | 600       | 4,800     | 40         | £532,800 | £6.39M       |
| **Q4**  | 18,000     | 900       | 7,200     | 60         | £800,100 | £9.60M       |

**Year 2 Total Revenue**: ~£5M

### Year 3 (Scale)

**Target**: £10M ARR

**Breakdown**:

- 2,000 Pro teams × 10 seats × £29 = £580k/month
- 100 Enterprise customers × 100 seats × £99 = £990k/month
- **Total MRR**: £1.57M
- **ARR**: £18.8M (overshooting goal → **£10M is conservative**)

---

## 📊 Unit Economics

### Customer Acquisition Cost (CAC)

**Channels**:

- **Organic** (SEO, Product Hunt, GitHub): £0 CAC (initial users)
- **Content Marketing** (blog, docs): £5k/month → 500 signups → £10 CAC
- **Paid Ads** (Google, LinkedIn): £20k/month → 400 signups → £50 CAC

**Blended CAC**: £25 per signup

**Conversion**:

- 10% of signups convert to Pro (£25 CAC ÷ 0.1 = £250 CAC per Pro customer)
- 0.5% of signups convert to Enterprise (£25 CAC ÷ 0.005 = £5,000 CAC per Enterprise customer)

### Lifetime Value (LTV)

**Pro Customer**:

- ARPU: £29/seat × 8 seats = £232/month
- Lifetime: 24 months (assumed)
- LTV: £232 × 24 = £5,568

**Enterprise Customer**:

- ARPU: £99/seat × 75 seats = £7,425/month
- Lifetime: 48 months (longer retention)
- LTV: £7,425 × 48 = £356,400

### LTV:CAC Ratio

**Pro**: £5,568 LTV ÷ £250 CAC = **22:1** ✅ (healthy, aim for 3:1+)

**Enterprise**: £356,400 LTV ÷ £5,000 CAC = **71:1** ✅ (excellent)

**Blended**: £10,984 LTV ÷ £400 CAC = **27:1** ✅

---

## 💸 Cost Structure

### Fixed Costs (Monthly)

| Item               | Cost              | Notes                                                                                                         |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Infrastructure** | £500              | Vercel Pro (£16), Supabase Team (£120), Sentry (£26), Axiom (free), EAS (£88), Stripe (£0 base), domain (£10) |
| **Salaries**       | £25,000           | 2 founders (£50k/year each, taking £25k initially)                                                            |
| **Legal**          | £200              | Company formation, contracts, privacy policy                                                                  |
| **Total Fixed**    | **£25,700/month** | **£308k/year**                                                                                                |

### Variable Costs (Per Customer)

| Tier           | Infrastructure Cost | Support Cost | Total Cost | Gross Margin              |
| -------------- | ------------------- | ------------ | ---------- | ------------------------- |
| **Free**       | £0.50/team          | £0           | £0.50      | -£0.50 (loss leader)      |
| **Pro**        | £2/team             | £10/month    | £12        | £220/month (95% margin)   |
| **Enterprise** | £50/team            | £500/month   | £550       | £6,875/month (93% margin) |

**Gross Margin**: 93-95% (typical for SaaS)

---

## 🎯 Break-Even Analysis

**Monthly Fixed Costs**: £25,700

**Break-Even** (when MRR = Fixed Costs):

- Need £25,700 MRR
- If all Pro customers (£232 ARPU): 111 Pro teams
- If all Enterprise (£7,425 ARPU): 4 Enterprise customers
- **Realistic Mix**: 100 Pro teams + 3 Enterprise = £30,575 MRR ✅

**Target**: Reach break-even by Month 6

---

## 📈 Growth Strategies

### Phase 1: MVP Launch (Month 1-3)

**Goal**: 100 signups, 10 Pro customers

**Tactics**:

1. **Product Hunt Launch**
   - Prepare assets (video demo, screenshots)
   - Engage community pre-launch
   - Aim for Product of the Day
   - Expected: 500-1,000 signups, 5-10 Pro conversions

2. **Hacker News "Show HN"**
   - Post with compelling story (built with AI, dogfooding)
   - Expected: 200-500 signups

3. **Dev Community Outreach**
   - Post on Reddit (r/programming, r/webdev, r/javascript)
   - Post on Dev.to, Hashnode
   - Expected: 100-200 signups

4. **GitHub Open Source Strategy**
   - Open-source CLI tool (free, drives awareness)
   - Star repo, share in weekly digests
   - Expected: 50-100 signups

### Phase 2: Content Marketing (Month 4-6)

**Goal**: 1,000 signups, 50 Pro customers

**Tactics**:

1. **Blog Content**
   - "How we prevent incomplete AI-generated code"
   - "Measuring DORA metrics for AI-native teams"
   - "The LumenFlow methodology"
   - SEO target: "AI workflow", "prevent incomplete code", "DORA metrics"

2. **Documentation**
   - Comprehensive docs (docs.lumenflow.app)
   - Tutorials, guides, best practices
   - SEO target: "work unit management", "gate runner"

3. **Case Studies**
   - Early customer success stories
   - Quantifiable results (time saved, quality improved)

### Phase 3: Paid Ads (Month 7-12)

**Goal**: 3,000 signups, 150 Pro customers

**Tactics**:

1. **Google Ads**
   - Target keywords: "JIRA alternative", "Linear alternative", "workflow management"
   - Budget: £5k/month
   - Expected: 200 signups/month

2. **LinkedIn Ads**
   - Target: Engineering Managers, CTOs, Dev Leads
   - Budget: £10k/month
   - Expected: 150 signups/month

3. **Retargeting**
   - Free users who haven't upgraded
   - Abandoned checkout flows

### Phase 4: Enterprise Sales (Month 12+)

**Goal**: 10 Enterprise customers (£75k MRR)

**Tactics**:

1. **Outbound Sales**
   - Hire 1 SDR (Sales Development Rep)
   - Target: Series A-C startups, 50-200 employees
   - Use Apollo, LinkedIn Sales Navigator

2. **Partnerships**
   - Partner with AI coding tools (GitHub Copilot, Cursor, Windsurf)
   - Offer LumenFlow as add-on

3. **Conferences**
   - Sponsor/speak at DevOps conferences
   - LeadDev, DevOpsDays, etc.

---

## 💡 Pricing Experiments

### A/B Tests to Run

1. **Free Trial vs Freemium**
   - Current: Freemium (free forever)
   - Test: 14-day free trial of Pro (then downgrade to Free)
   - Hypothesis: Urgency increases conversions

2. **Annual vs Monthly**
   - Current: Monthly only
   - Test: Offer annual plan (£290/seat/year, 2 months free)
   - Hypothesis: Annual reduces churn, improves cash flow

3. **Usage-Based Pricing**
   - Current: Per-seat
   - Test: Per-WU (£0.50/WU, unlimited seats)
   - Hypothesis: Lower barrier for small teams with many members

### Pricing Changes to Consider

**If conversion is low (<5%)**:

- Lower Pro to £19/seat (closer to Linear)
- Add "Team" tier (£39/team flat, up to 10 members)

**If churn is high (>10%/month)**:

- Add annual contracts (lock in customers)
- Improve onboarding (reduce time-to-value)
- Add integrations (increase stickiness)

---

## 🎯 Revenue Milestones

| Milestone             | MRR   | ARR Run Rate | Free Users | Pro Teams | Enterprise |
| --------------------- | ----- | ------------ | ---------- | --------- | ---------- |
| **Launch**            | £0    | £0           | 0          | 0         | 0          |
| **Break-Even**        | £26k  | £310k        | 1,000      | 100       | 3          |
| **Seed Fundable**     | £50k  | £600k        | 2,000      | 200       | 8          |
| **Series A Fundable** | £200k | £2.4M        | 8,000      | 800       | 30         |
| **Profitability**     | £500k | £6M          | 20,000     | 2,000     | 75         |

---

## 🚀 Fundraising Strategy

### Bootstrap (Month 1-12)

**Goal**: Reach £50k MRR without funding

**Runway**: 6-12 months (founders' savings)

**Focus**: Product-market fit, customer discovery, MVP iteration

### Seed Round (Month 12-18)

**Goal**: Raise £1-2M at £8-12M valuation

**Use of Funds**:

- Hire 3 engineers (£300k/year)
- Hire 1 product marketer (£80k/year)
- Paid ads budget (£20k/month)
- Sales rep (£60k/year)
- **Runway**: 18-24 months

**Traction Required**:

- £50k MRR
- 50% MoM growth
- <5% churn
- 3-5 Enterprise customers

### Series A (Month 24-36)

**Goal**: Raise £8-15M at £50-80M valuation

**Use of Funds**:

- Hire 10 engineers (£1M/year)
- Hire sales team (5 AEs, £400k/year)
- Expand to US market
- **Runway**: 24-36 months

**Traction Required**:

- £200k MRR (£2.4M ARR)
- 20% MoM growth
- <3% churn
- 20+ Enterprise customers
- Clear path to £10M ARR

---

## 📊 Key Metrics to Track

### Growth Metrics

- **Signups** (daily, weekly, monthly)
- **Activation Rate** (% who create first WU)
- **Free → Pro Conversion** (% and time-to-convert)
- **Pro → Enterprise Conversion** (% and time-to-convert)

### Revenue Metrics

- **MRR** (Monthly Recurring Revenue)
- **ARR** (Annual Recurring Revenue)
- **ARPU** (Average Revenue Per User)
- **LTV** (Lifetime Value)
- **CAC** (Customer Acquisition Cost)
- **LTV:CAC Ratio** (target: 3:1+)

### Retention Metrics

- **Churn Rate** (monthly, annual)
- **Net Revenue Retention** (NRR, target: 110%+)
- **Gross Revenue Retention** (GRR, target: 90%+)

### Product Metrics

- **DAU/MAU** (Daily/Monthly Active Users, target: 30%+)
- **WUs Created** (per team, per user)
- **Gates Run** (per WU)
- **Time to First Value** (TTFV, time from signup to first WU completed)

---

## 🎯 Success Criteria

**Year 1**: £500k ARR, 150 Pro teams, 10 Enterprise customers

**Year 2**: £5M ARR, 900 Pro teams, 60 Enterprise customers

**Year 3**: £10M+ ARR, 2,000 Pro teams, 100 Enterprise customers

**Exit Options** (Year 5+):

- Acquisition by Atlassian, GitHub, Linear, etc. (£50-200M)
- IPO (if >£50M ARR, 50%+ YoY growth)
- Profitable independent business (£20M+ ARR, 40%+ margin)

---

**End of Revenue Model**
