/**
 * @file docs-sync.ts
 * LumenFlow docs:sync command for syncing agent docs to existing projects (WU-1083)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type VendorType = 'claude' | 'cursor' | 'aider' | 'all' | 'none';

export interface SyncOptions {
  force: boolean;
  vendor?: VendorType;
}

export interface SyncResult {
  created: string[];
  skipped: string[];
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Process template content by replacing placeholders
 */
function processTemplate(content: string, tokens: Record<string, string>): string {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

function getRelativePath(targetDir: string, filePath: string): string {
  return path.relative(targetDir, filePath).split(path.sep).join('/');
}

/**
 * Create a directory if missing
 */
async function createDirectory(
  dirPath: string,
  result: SyncResult,
  targetDir: string,
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    result.created.push(getRelativePath(targetDir, dirPath));
  }
}

/**
 * Create a file, respecting force option
 */
async function createFile(
  filePath: string,
  content: string,
  force: boolean,
  result: SyncResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);

  if (fs.existsSync(filePath) && !force) {
    result.skipped.push(relativePath);
    return;
  }

  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  result.created.push(relativePath);
}

// Agent onboarding docs templates (duplicated from init.ts for modularity)
const QUICK_REF_COMMANDS_TEMPLATE = `# Quick Reference: LumenFlow Commands

**Last updated:** {{DATE}}

---

## Project Setup

| Command                                       | Description                             |
| --------------------------------------------- | --------------------------------------- |
| \`pnpm exec lumenflow init\`                    | Scaffold minimal LumenFlow core         |
| \`pnpm exec lumenflow init --full\`             | Add docs/04-operations task scaffolding |
| \`pnpm exec lumenflow init --framework <name>\` | Add framework hint + overlay docs       |
| \`pnpm exec lumenflow init --force\`            | Overwrite existing files                |

---

## WU Management

| Command                                                                                                                                                                                                               | Description                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| \`pnpm wu:create --id WU-XXX --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "path" --test-paths-unit "path" --exposure backend-only --spec-refs "~/.lumenflow/plans/WU-XXX.md"\` | Create new WU                                 |
| \`pnpm wu:claim --id WU-XXX --lane <Lane>\`                                                                                                                                                                             | Claim WU (creates worktree)                   |
| \`pnpm wu:done --id WU-XXX\`                                                                                                                                                                                            | Complete WU (merge, stamp, cleanup)           |
| \`pnpm wu:block --id WU-XXX --reason "Reason"\`                                                                                                                                                                         | Block a WU                                    |
| \`pnpm wu:unblock --id WU-XXX\`                                                                                                                                                                                         | Unblock a WU                                  |

---

## Gates

| Command                  | Description                |
| ------------------------ | -------------------------- |
| \`pnpm gates\`             | Run all quality gates      |
| \`pnpm gates --docs-only\` | Run gates for docs changes |
| \`pnpm format\`            | Format all files           |
| \`pnpm lint\`              | Run linter                 |
| \`pnpm typecheck\`         | Run TypeScript check       |

---

## File Paths

| Path                                      | Description          |
| ----------------------------------------- | -------------------- |
| \`docs/04-operations/tasks/wu/WU-XXX.yaml\` | WU specification     |
| \`docs/04-operations/tasks/status.md\`      | Current status board |
| \`.lumenflow/stamps/WU-XXX.done\`           | Completion stamp     |
| \`worktrees/<lane>-wu-xxx/\`                | Worktree directory   |
`;

const FIRST_WU_MISTAKES_TEMPLATE = `# First WU Mistakes

**Last updated:** {{DATE}}

Common mistakes agents make on their first WU, and how to avoid them.

---

## Mistake 1: Not Using Worktrees

### Wrong

\`\`\`bash
# Working directly in main
vim src/feature.ts
git commit -m "feat: add feature"
git push origin main
\`\`\`

### Right

\`\`\`bash
# Claim first, then work in worktree
pnpm wu:claim --id WU-123 --lane Core
cd worktrees/core-wu-123
vim src/feature.ts
git commit -m "feat: add feature"
git push origin lane/core/wu-123
cd /path/to/main
pnpm wu:done --id WU-123
\`\`\`

---

## Mistake 2: Forgetting to Run wu:done

**TL;DR:** After gates pass, ALWAYS run \`pnpm wu:done --id WU-XXX\`.

---

## Mistake 3: Working Outside code_paths

Only edit files within the specified \`code_paths\`.

---

## Quick Checklist

- [ ] Claim the WU with \`pnpm wu:claim\`
- [ ] cd to the worktree IMMEDIATELY
- [ ] Work only in the worktree
- [ ] Run gates before wu:done
- [ ] ALWAYS run wu:done
`;

const TROUBLESHOOTING_WU_DONE_TEMPLATE = `# Troubleshooting: wu:done Not Run

**Last updated:** {{DATE}}

This is the most common mistake agents make.

---

## The Fix

### Rule: ALWAYS Run wu:done

After gates pass, you MUST run:

\`\`\`bash
cd /path/to/main
pnpm wu:done --id WU-XXX
\`\`\`

Do NOT:

- Ask "Should I run wu:done?"
- Write "To Complete: pnpm wu:done"
- Wait for permission

---

## What wu:done Does

1. Validates the worktree exists and has commits
2. Runs gates in the worktree (not main)
3. Fast-forward merges to main
4. Creates the done stamp
5. Updates status and backlog docs
6. Removes the worktree
7. Pushes to origin
`;

const AGENT_SAFETY_CARD_TEMPLATE = `# Agent Safety Card

**Last updated:** {{DATE}}

Quick reference for AI agents working in LumenFlow projects.

---

## Stop and Ask When

- Same error repeats 3 times
- Auth or permissions changes needed
- PII/PHI/secrets involved
- Cloud spend decisions

---

## Never Do

| Action                   | Why              |
| ------------------------ | ---------------- |
| \`git reset --hard\`       | Data loss        |
| \`git push --force\`       | History rewrite  |
| \`--no-verify\`            | Bypasses safety  |
| Work in main after claim | Breaks isolation |
| Skip wu:done             | Incomplete WU    |

---

## Always Do

| Action                     | Why              |
| -------------------------- | ---------------- |
| Read WU spec first         | Understand scope |
| cd to worktree after claim | Isolation        |
| Write tests before code    | TDD              |
| Run gates before wu:done   | Quality          |
| Run wu:done                | Complete WU      |
`;

const WU_CREATE_CHECKLIST_TEMPLATE = `# WU Creation Checklist

**Last updated:** {{DATE}}

Before running \`pnpm wu:create\`, verify these items.

---

## Step 1: Check Valid Lanes

\`\`\`bash
grep -A 30 "lanes:" .lumenflow.config.yaml
\`\`\`

**Format:** \`"Parent: Sublane"\` (colon + single space)

---

## Step 2: Required Fields

| Field | Required For | Example |
|-------|--------------|---------|
| \`--id\` | All | \`WU-1234\` |
| \`--lane\` | All | \`"Experience: Chat"\` |
| \`--title\` | All | \`"Add feature"\` |
| \`--description\` | All | \`"Context: ... Problem: ... Solution: ..."\` |
| \`--acceptance\` | All | \`--acceptance "Works"\` (repeatable) |
| \`--exposure\` | All | \`ui\`, \`api\`, \`backend-only\`, \`documentation\` |
| \`--code-paths\` | Code WUs | \`"src/a.ts,src/b.ts"\` |
| \`--test-paths-unit\` | Code WUs | \`"src/__tests__/a.test.ts"\` |
| \`--spec-refs\` | Feature WUs | \`"~/.lumenflow/plans/WU-XXX.md"\` |

---

## Step 3: Plan Storage

Plans go in \`~/.lumenflow/plans/\` (NOT in project):

\`\`\`bash
mkdir -p ~/.lumenflow/plans
vim ~/.lumenflow/plans/WU-XXX-plan.md
\`\`\`

Reference in wu:create:
\`\`\`bash
--spec-refs "~/.lumenflow/plans/WU-XXX-plan.md"
\`\`\`

---

## Step 4: Validate First

\`\`\`bash
pnpm wu:create --id WU-XXX ... --validate
\`\`\`

Fix errors, then remove \`--validate\` to create.
`;

// Claude skills templates
const WU_LIFECYCLE_SKILL_TEMPLATE = `---
name: wu-lifecycle
description: Work Unit claim/block/done workflow automation.
version: 1.0.0
---

# WU Lifecycle Skill

## State Machine

\`\`\`
ready -> in_progress -> waiting/blocked -> done
\`\`\`

## Core Commands

\`\`\`bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <lane>
cd worktrees/<lane>-wu-xxx   # IMMEDIATELY

# Complete WU (from main)
cd ../..
pnpm wu:done --id WU-XXX
\`\`\`
`;

const WORKTREE_DISCIPLINE_SKILL_TEMPLATE = `---
name: worktree-discipline
description: Prevents the "absolute path trap" in Write/Edit/Read tools.
version: 1.0.0
---

# Worktree Discipline: Absolute Path Trap Prevention

**Purpose**: Prevent AI agents from bypassing worktree isolation via absolute file paths.

## The Absolute Path Trap

**Problem**: AI agents using Write/Edit/Read tools can bypass worktree isolation by passing absolute paths.

## Golden Rules

1. **Always verify pwd** before file operations
2. **Never use absolute paths** in Write/Edit/Read tools
3. **When in doubt, use relative paths**
`;

const LUMENFLOW_GATES_SKILL_TEMPLATE = `---
name: lumenflow-gates
description: Quality gates troubleshooting (format, lint, typecheck, tests).
version: 1.0.0
---

# LumenFlow Gates Skill

## Gate Sequence

\`\`\`
pnpm gates = format:check -> lint -> typecheck -> spec:linter -> tests
\`\`\`

## Fix Patterns

| Gate      | Auto-fix        | Manual                              |
| --------- | --------------- | ----------------------------------- |
| Format    | \`pnpm format\`   | -                                   |
| Lint      | \`pnpm lint:fix\` | Fix reported issues                 |
| Typecheck | -               | Fix type errors (first error first) |
| Tests     | -               | Debug, fix mocks, update snapshots  |
`;

/**
 * Sync agent onboarding docs to an existing project
 */
export async function syncAgentDocs(
  targetDir: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const result: SyncResult = {
    created: [],
    skipped: [],
  };

  const tokens = {
    DATE: getCurrentDate(),
  };

  const onboardingDir = path.join(
    targetDir,
    'docs',
    '04-operations',
    '_frameworks',
    'lumenflow',
    'agent',
    'onboarding',
  );

  await createDirectory(onboardingDir, result, targetDir);

  await createFile(
    path.join(onboardingDir, 'quick-ref-commands.md'),
    processTemplate(QUICK_REF_COMMANDS_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'first-wu-mistakes.md'),
    processTemplate(FIRST_WU_MISTAKES_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'troubleshooting-wu-done.md'),
    processTemplate(TROUBLESHOOTING_WU_DONE_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'agent-safety-card.md'),
    processTemplate(AGENT_SAFETY_CARD_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'wu-create-checklist.md'),
    processTemplate(WU_CREATE_CHECKLIST_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  return result;
}

/**
 * Sync Claude skills to an existing project
 */
export async function syncSkills(
  targetDir: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const result: SyncResult = {
    created: [],
    skipped: [],
  };

  const vendor = options.vendor ?? 'none';
  if (vendor !== 'claude' && vendor !== 'all') {
    return result;
  }

  const tokens = {
    DATE: getCurrentDate(),
  };

  const skillsDir = path.join(targetDir, '.claude', 'skills');

  // wu-lifecycle skill
  const wuLifecycleDir = path.join(skillsDir, 'wu-lifecycle');
  await createDirectory(wuLifecycleDir, result, targetDir);
  await createFile(
    path.join(wuLifecycleDir, 'SKILL.md'),
    processTemplate(WU_LIFECYCLE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // worktree-discipline skill
  const worktreeDir = path.join(skillsDir, 'worktree-discipline');
  await createDirectory(worktreeDir, result, targetDir);
  await createFile(
    path.join(worktreeDir, 'SKILL.md'),
    processTemplate(WORKTREE_DISCIPLINE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // lumenflow-gates skill
  const gatesDir = path.join(skillsDir, 'lumenflow-gates');
  await createDirectory(gatesDir, result, targetDir);
  await createFile(
    path.join(gatesDir, 'SKILL.md'),
    processTemplate(LUMENFLOW_GATES_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  return result;
}

/**
 * Parse vendor flag from arguments
 */
function parseVendorArg(args: string[]): VendorType | undefined {
  const vendorIndex = args.findIndex((arg) => arg === '--vendor');
  if (vendorIndex !== -1 && args[vendorIndex + 1]) {
    const vendor = args[vendorIndex + 1].toLowerCase();
    if (['claude', 'cursor', 'aider', 'all', 'none'].includes(vendor)) {
      return vendor as VendorType;
    }
  }
  return undefined;
}

/**
 * CLI entry point for docs:sync command
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const vendor = parseVendorArg(args) ?? 'claude'; // Default to claude
  const targetDir = process.cwd();

  console.log('[lumenflow docs:sync] Syncing agent documentation...');
  console.log(`  Vendor: ${vendor}`);
  console.log(`  Force: ${force}`);

  const docsResult = await syncAgentDocs(targetDir, { force });
  const skillsResult = await syncSkills(targetDir, { force, vendor });

  const created = [...docsResult.created, ...skillsResult.created];
  const skipped = [...docsResult.skipped, ...skillsResult.skipped];

  if (created.length > 0) {
    console.log('\nCreated:');
    created.forEach((f) => console.log(`  + ${f}`));
  }

  if (skipped.length > 0) {
    console.log('\nSkipped (already exists, use --force to overwrite):');
    skipped.forEach((f) => console.log(`  - ${f}`));
  }

  console.log('\n[lumenflow docs:sync] Done!');
}

// CLI entry point (WU-1071 pattern: import.meta.main)
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}
