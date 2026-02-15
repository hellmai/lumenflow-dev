---
id: constraints
name: Constraints
required: true
order: 1000
tokens: [WU_ID]
---

---

<constraints>
CRITICAL RULES - ENFORCE BEFORE EVERY ACTION:

1. TDD CHECKPOINT (VERIFY BEFORE IMPLEMENTATION)
   - Did you write tests BEFORE implementation?
   - Is there at least one failing test for each acceptance criterion?
   - Never skip the RED phase - failing tests prove the test works

2. ANTI-LOOP GUARD (LumenFlow §7.3)
   - Max 3 attempts per unique error before escalating
   - If same error repeats 3x, STOP and report with full context
   - Retry with different approach, not same command

3. STOP-AND-ASK TRIGGERS (LumenFlow §7.2 - narrow scope)
   - Policy changes, auth/permissions modifications
   - PII/safety issues, cloud spend, secrets, backups
   - Same error repeats 3x
   - For ordinary errors: fix and retry autonomously (up to 3 attempts)

4. VERIFY COMPLETION before reporting success
   - Run: node packages/@lumenflow/agent/dist/agent-verification.js {WU_ID} (from shared checkout)
   - Exit 0 = passed, Exit 1 = INCOMPLETE
   - Never report "done" if verification fails

5. NEVER FABRICATE COMPLETION
   - If blockers remain, report INCOMPLETE
   - If verification fails, summarize failures
   - Honesty over false completion

6. GIT WORKFLOW (CRITICAL - GitHub rules reject merge commits)
   - GitHub REJECTS merge commits on main
   - ALWAYS use `git rebase origin/main` before push
   - Push to main via `git push origin lane/...:main` (fast-forward only)
   - NEVER use `git merge` on main branch
   - Use `pnpm wu:prep` from worktree, then `pnpm wu:done` from main (WU-1223)

7. MEMORY LAYER COORDINATION (INIT-007)
   - Use `pnpm mem:checkpoint --wu {WU_ID}` to save progress before risky operations
   - Check `pnpm mem:inbox --wu {WU_ID}` periodically for parallel signals from other agents
   - Checkpoint triggers (WU-1943): checkpoint after each acceptance criterion completed, checkpoint before gates, checkpoint every 30 tool calls

8. SKIP-GATES AUTONOMY (WU-1142)
   - If gates fail, first check if failure is pre-existing on main: `git checkout main && pnpm gates`
   - If failure exists on main (not your change), use: `pnpm wu:done --id {WU_ID} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX`
   - Do NOT ask for approval - autonomous skip-gates for pre-existing failures is correct
   - This prevents getting stuck on infrastructure debt
     </constraints>

<!-- LUMENFLOW_SPAWN_END -->
