// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Input parsing for wu:done validators.
 */

import { parseWUArgs } from './arg-parser.js';
import { die, ProcessExitError } from './error-handler.js';
import { EXIT_CODES, PATTERNS } from './wu-constants.js';

/**
 * Validates command-line inputs and WU ID format
 * @param {string[]} argv - Process arguments
 * @returns {{ args: object, id: string }} Parsed args and validated WU ID
 */
export function validateInputs(argv: string[]) {
  const args = parseWUArgs(argv);
  if (args.help || !args.id) {
    console.log(
      'Usage: pnpm wu:done --id WU-334 [OPTIONS]\n\n' +
        'Options:\n' +
        '  --worktree <path>   Override worktree path (default: worktrees/<lane>-<wu-id>)\n' +
        '  --no-auto           Skip auto-updating YAML/backlog/status (you staged manually)\n' +
        '  --no-remove         Skip worktree removal\n' +
        '  --no-merge          Skip auto-merging lane branch to main\n' +
        '  --delete-branch     Delete lane branch after merge (both local and remote)\n' +
        '  --create-pr         Create PR instead of auto-merge (requires gh CLI)\n' +
        '  --pr-draft          Create PR as draft (use with --create-pr)\n' +
        '  --skip-gates        Skip gates check (USE WITH EXTREME CAUTION)\n' +
        '  --docs-only         Run docs-only gates (requires exposure: documentation)\n' +
        '  --reason "<text>"   Required with --skip-gates or --override-owner\n' +
        '  --fix-wu WU-{id}    Required with --skip-gates: WU ID that will fix the failures\n' +
        '  --allow-todo        Allow TODO comments in code (requires justification in WU notes)\n' +
        '  --override-owner    Override ownership check (requires --reason, audited)\n' +
        '  --force, -f         Bypass dirty-main pre-merge guard (audited, WU-1503)\n' +
        '  --no-auto-rebase    Disable auto-rebase on branch divergence (WU-1303)\n' +
        '  --require-agents    Block completion if mandatory agents not invoked (WU-1542)\n' +
        '  --help, -h          Show this help\n\n' +
        '⚠️  SKIP-GATES WARNING:\n' +
        '  Only use --skip-gates when:\n' +
        '    • Test failures are confirmed pre-existing (not introduced by your WU)\n' +
        '    • A separate WU exists to fix those failures (specify with --fix-wu)\n' +
        '    • Your WU work is genuinely complete\n\n' +
        '  NEVER use --skip-gates for failures introduced by your WU!\n' +
        '  All skip-gates events are logged to .lumenflow/skip-gates-audit.log\n\n' +
        '📝 WU VALIDATOR:\n' +
        '  Automatically scans code_paths for:\n' +
        '    • TODO/FIXME/HACK/XXX comments (fails validation unless --allow-todo)\n' +
        '    • Mock/Stub/Fake classes in production code (warning only)\n' +
        '  Use --allow-todo only for legitimate cases with justification in WU notes.\n',
    );
    throw new ProcessExitError(
      args.help ? 'Help displayed' : 'Missing required --id flag',
      args.help ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR,
    );
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  return { args, id };
}
