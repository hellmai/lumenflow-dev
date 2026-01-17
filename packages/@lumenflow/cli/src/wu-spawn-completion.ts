/**
 * Generate the Completion Workflow section for sub-agents (WU-2682).
 *
 * Explicitly instructs sub-agents to run wu:done autonomously after gates pass.
 * This prevents agents from asking permission instead of completing.
 *
 * @param {string} id - WU ID
 * @returns {string} Completion Workflow section
 */
export function generateCompletionWorkflowSection(id: string): string {
  return `## Completion Workflow

**CRITICAL: Complete autonomously. Do NOT ask for permission.**

After all acceptance criteria are satisfied:

1. Run gates in the worktree: \`pnpm gates\`
2. If gates pass, cd back to main checkout
3. Run: \`pnpm wu:done --id ${id}\`

\`\`\`bash
# From worktree, after gates pass:
cd /path/to/main  # NOT the worktree
pnpm wu:done --id ${id}
\`\`\`

**wu:done** handles: merge to main, stamp creation, worktree cleanup.

**Do not ask** "should I run wu:done?" — just run it when gates pass.`;
}
