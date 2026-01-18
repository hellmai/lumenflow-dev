# LumenFlow GitHub App

AI-native workflow enforcement via GitHub.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Your Vercel Account                       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │         Webhook Handler (this repo)                 │   │
│   │         ~200 lines, Edge Function                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │ webhooks
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                               │
│                                                             │
│   Client Repo A          Client Repo B          Client C    │
│   ├── .github/           ├── .github/           └── ...     │
│   │   └── workflows/     │   └── workflows/                 │
│   └── PRs (WUs)          └── PRs (WUs)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## How Updates Work

### App Updates (Instant)

When you deploy this webhook handler:

- **All clients get updates immediately**
- No client action required
- You control the rollout

```bash
# You deploy
vercel --prod

# All clients instantly get:
# - New validation rules
# - Bug fixes
# - Feature improvements
```

### Workflow Updates (Versioned)

Clients pin their workflow to a version:

```yaml
# Client's .github/workflows/lumenflow-gates.yml
- uses: hellmai/lumenflow-gates@v1 # Pinned to v1
```

**To release updates:**

```bash
# 1. Push changes to hellmai/lumenflow-gates repo
# 2. Create release tag
git tag v1.1.0
git push --tags

# 3. Clients update when ready
# - uses: hellmai/lumenflow-gates@v1.1.0  # Specific version
# - uses: hellmai/lumenflow-gates@v1      # Latest v1.x (auto-updates)
```

### Template Updates (Optional)

PR templates and config are copied once. Updates are:

- Announced via changelog
- Client applies manually (or you provide migration script)

## Billing Options

### Option 1: GitHub Marketplace (Recommended)

GitHub handles all billing. You just check the plan:

```typescript
// GitHub tells us what plan they're on
const { data } = await octokit.apps.getSubscriptionPlanForAccount({
  account_id: installation.account.id,
});

const plan = data.plan.name; // 'free', 'team', 'business'
```

**Pros:**

- Zero billing code
- GitHub handles invoices, taxes, refunds
- Users pay via existing GitHub billing

**Setup:**

1. Go to github.com/marketplace/new
2. Create listing for LumenFlow
3. Set pricing tiers
4. GitHub handles the rest

### Option 2: Stripe Direct

More control, more work:

```typescript
// Check our database for subscription
const sub = await db.subscriptions.findOne({
  where: { githubInstallationId: installation.id },
});

if (!sub || sub.status !== 'active') {
  // Redirect to Stripe checkout
}
```

**Pros:**

- Higher margins (no GitHub cut)
- Custom pricing models
- Works with non-GitHub clients

### Option 3: Simple License Keys (Enterprise)

For big clients who want invoices:

```typescript
// Check license key in repo config
const config = await getRepoConfig(repo);
const license = await validateLicense(config.lumenflow.license);

if (!license.valid) {
  // Block with upgrade message
}
```

## Pricing Strategy

| Tier       | Price  | WUs/month | Features                       |
| ---------- | ------ | --------- | ------------------------------ |
| Free       | $0     | 10        | Basic validation, 1 lane       |
| Team       | $29/mo | 100       | All lanes, email support       |
| Business   | $99/mo | 500       | Priority support, custom lanes |
| Enterprise | Custom | Unlimited | SSO, SLA, dedicated support    |

## Deployment

```bash
# 1. Clone this repo
git clone https://github.com/hellmai/lumenflow-github-app

# 2. Set environment variables
cp .env.example .env.local
# Edit with your GitHub App credentials

# 3. Deploy to Vercel
vercel --prod

# 4. Configure GitHub App webhook URL
# → https://your-app.vercel.app/api/webhook
```

## Files

```
src/
├── webhooks/
│   └── handler.ts      # Main webhook handler (~150 lines)
├── lib/
│   ├── billing.ts      # Subscription checking
│   ├── wu-validator.ts # PR body parsing
│   ├── lane-enforcer.ts # WIP limit checking
│   └── stamp-creator.ts # Completion stamps
templates/
├── workflows/
│   └── lumenflow-gates.yml  # Client copies this
├── PULL_REQUEST_TEMPLATE.md # Client copies this
└── issue_templates/
    └── work-unit.yml        # Client copies this
```

## Local Development

```bash
# Start local tunnel for webhook testing
vercel dev

# In another terminal
npx smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/api/webhook
```
