---
id: code-craft
name: Code Craft (Claude)
required: true
order: 55
tokens: []
---

## Code Craft (Claude)

Before writing custom code, run a focused library/context search for existing project patterns and external libraries.

1. **Extract repeated literals to named constants** (project-configured threshold in `eslint.config.mjs`).
   <example>
   // Before
   if (status === 'in_progress') notify('in_progress');
   if (nextStatus === 'in_progress') log('in_progress');
   if (prevStatus === 'in_progress') audit('in_progress');

// After
const STATUS_IN_PROGRESS = 'in_progress';
if (status === STATUS_IN_PROGRESS) notify(STATUS_IN_PROGRESS);
</example>

2. **Write contextual error messages**: what failed, why, and how to fix it.
   <example>
   // Before
   die('failed');

// After
die('Failed to parse workspace.yaml: missing lane field. Run pnpm lane:setup to regenerate.');
</example>

3. **Prefer existing libraries for common problems** (parsing, validation, dates, schema, paths) before custom code.
   <example>
   // Before
   function parseDate(input: string) { /_ custom parser _/ }

// After
import { parseISO } from 'date-fns';
const parsed = parseISO(input);
</example>

4. **Use type narrowing instead of unsafe casts**.
   <example>
   // Before
   const id = (payload as { id: string }).id;

// After
if (payload && typeof payload === 'object' && 'id' in payload) {
const id = String(payload.id);
}
</example>
