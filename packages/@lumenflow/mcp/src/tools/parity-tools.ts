/**
 * @file parity-tools.ts
 * @description Wave-1 and Wave-2 public parity tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1482: Wave-1 public parity tools
 * WU-1483: Wave-2 public parity tools (file, git, plan, signal, wu:proto)
 */

import { z } from 'zod';
import { gatesSchema, lumenflowInitSchema, initiativePlanSchema } from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  ErrorMessages,
  CliArgs,
  SharedErrorMessages,
  SuccessMessages,
  success,
  error,
  buildGatesArgs,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';

// WU-1482: Schemas for wave-1 parity commands not yet modeled in @lumenflow/core
const backlogPruneSchema = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  stale_days_in_progress: z.number().optional(),
  stale_days_ready: z.number().optional(),
  archive_days: z.number().optional(),
});

const docsSyncMcpSchema = z.object({
  vendor: z.enum(['claude', 'cursor', 'aider', 'all', 'none']).optional(),
  force: z.boolean().optional(),
});

const laneHealthSchema = z.object({
  json: z.boolean().optional(),
  verbose: z.boolean().optional(),
  no_coverage: z.boolean().optional(),
});

const laneSuggestSchema = z.object({
  dry_run: z.boolean().optional(),
  interactive: z.boolean().optional(),
  output: z.string().optional(),
  json: z.boolean().optional(),
  no_llm: z.boolean().optional(),
  include_git: z.boolean().optional(),
});

const stateBootstrapSchema = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
  wu_dir: z.string().optional(),
  state_dir: z.string().optional(),
});

const stateCleanupSchema = z.object({
  dry_run: z.boolean().optional(),
  signals_only: z.boolean().optional(),
  memory_only: z.boolean().optional(),
  events_only: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const stateDoctorSchema = z.object({
  fix: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const syncTemplatesMcpSchema = z.object({
  dry_run: z.boolean().optional(),
  verbose: z.boolean().optional(),
  check_drift: z.boolean().optional(),
});

// WU-1483: Schemas for wave-2 parity commands not yet modeled in @lumenflow/core
const fileReadSchema = z.object({
  path: z.string().optional(),
  encoding: z.string().optional(),
  start_line: z.number().optional(),
  end_line: z.number().optional(),
  max_size: z.number().optional(),
});

const fileWriteSchema = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
  encoding: z.string().optional(),
  no_create_dirs: z.boolean().optional(),
});

const fileEditSchema = z.object({
  path: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  encoding: z.string().optional(),
  replace_all: z.boolean().optional(),
});

const fileDeleteSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
  force: z.boolean().optional(),
});

const gitStatusSchema = z.object({
  base_dir: z.string().optional(),
  path: z.string().optional(),
  porcelain: z.boolean().optional(),
  short: z.boolean().optional(),
});

const gitDiffSchema = z.object({
  base_dir: z.string().optional(),
  ref: z.string().optional(),
  staged: z.boolean().optional(),
  name_only: z.boolean().optional(),
  stat: z.boolean().optional(),
  path: z.string().optional(),
});

const gitLogSchema = z.object({
  base_dir: z.string().optional(),
  ref: z.string().optional(),
  oneline: z.boolean().optional(),
  max_count: z.number().optional(),
  format: z.string().optional(),
  since: z.string().optional(),
  author: z.string().optional(),
});

const gitBranchSchema = z.object({
  base_dir: z.string().optional(),
  list: z.boolean().optional(),
  all: z.boolean().optional(),
  remotes: z.boolean().optional(),
  show_current: z.boolean().optional(),
  contains: z.string().optional(),
});

const planCreateSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
});

const planEditSchema = z.object({
  id: z.string().optional(),
  section: z.string().optional(),
  content: z.string().optional(),
  append: z.string().optional(),
});

const planLinkSchema = z.object({
  id: z.string().optional(),
  plan: z.string().optional(),
});

const planPromoteSchema = z.object({
  id: z.string().optional(),
  force: z.boolean().optional(),
});

const signalCleanupSchema = z.object({
  dry_run: z.boolean().optional(),
  ttl: z.string().optional(),
  unread_ttl: z.string().optional(),
  max_entries: z.number().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const wuProtoSchema = z.object({
  lane: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  code_paths: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  assigned_to: z.string().optional(),
});

// ============================================================================
// Wave-1 Public Parity Operations (WU-1482)
// ============================================================================

/**
 * backlog_prune - Clean stale backlog entries
 */
export const backlogPruneTool: ToolDefinition = {
  name: 'backlog_prune',
  description: 'Clean stale backlog entries and archive old completed WUs',
  inputSchema: backlogPruneSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.execute) args.push('--execute');
    if (input.dry_run) args.push('--dry-run');
    if (input.stale_days_in_progress !== undefined) {
      args.push('--stale-days-in-progress', String(input.stale_days_in_progress));
    }
    if (input.stale_days_ready !== undefined) {
      args.push('--stale-days-ready', String(input.stale_days_ready));
    }
    if (input.archive_days !== undefined) {
      args.push('--archive-days', String(input.archive_days));
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('backlog:prune', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Backlog prune complete' });
    }
    return error(
      result.stderr || result.error?.message || 'backlog:prune failed',
      ErrorCodes.BACKLOG_PRUNE_ERROR,
    );
  },
};

/**
 * docs_sync - Sync agent docs to existing project
 */
export const docsSyncTool: ToolDefinition = {
  name: 'docs_sync',
  description: 'Sync agent onboarding docs and skills to existing projects',
  inputSchema: docsSyncMcpSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.vendor) args.push('--vendor', input.vendor as string);
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('docs:sync', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Docs sync complete' });
    }
    return error(
      result.stderr || result.error?.message || 'docs:sync failed',
      ErrorCodes.DOCS_SYNC_ERROR,
    );
  },
};

/**
 * gates - Public gates command
 */
export const gatesTool: ToolDefinition = {
  name: 'gates',
  description: 'Run LumenFlow quality gates',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input);
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || SuccessMessages.ALL_GATES_PASSED });
    }
    return error(
      result.stderr || result.error?.message || 'gates failed',
      ErrorCodes.GATES_ALIAS_ERROR,
    );
  },
};

/**
 * gates_docs - Public docs-only gates alias
 */
export const gatesDocsTool: ToolDefinition = {
  name: 'gates_docs',
  description: 'Run docs-only quality gates',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input, { forceDocsOnly: true });
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Docs-only gates passed' });
    }
    return error(
      result.stderr || result.error?.message || 'gates:docs failed',
      ErrorCodes.GATES_ALIAS_ERROR,
    );
  },
};

/**
 * lane_health - Diagnose lane configuration issues
 */
export const laneHealthTool: ToolDefinition = {
  name: 'lane_health',
  description: 'Check lane configuration health (overlaps and coverage gaps)',
  inputSchema: laneHealthSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.json) args.push('--json');
    if (input.verbose) args.push('--verbose');
    if (input.no_coverage) args.push('--no-coverage');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lane:health', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Lane health check complete' });
      }
    }
    return error(
      result.stderr || result.error?.message || 'lane:health failed',
      ErrorCodes.LANE_HEALTH_ERROR,
    );
  },
};

/**
 * lane_suggest - Suggest lane definitions from project context
 */
export const laneSuggestTool: ToolDefinition = {
  name: 'lane_suggest',
  description: 'Generate lane suggestions from codebase context',
  inputSchema: laneSuggestSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.interactive) args.push('--interactive');
    if (input.output) args.push('--output', input.output as string);
    if (input.json) args.push('--json');
    if (input.no_llm) args.push('--no-llm');
    if (input.include_git) args.push('--include-git');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lane:suggest', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Lane suggestions generated' });
      }
    }
    return error(
      result.stderr || result.error?.message || 'lane:suggest failed',
      ErrorCodes.LANE_SUGGEST_ERROR,
    );
  },
};

/**
 * lumenflow - Public initializer command
 */
export const lumenflowTool: ToolDefinition = {
  name: 'lumenflow',
  description: 'Initialize LumenFlow in a project',
  inputSchema: lumenflowInitSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.client) args.push('--client', input.client as string);
    if (input.merge) args.push('--merge');
    if (input.full) args.push('--full');
    if (input.minimal) args.push('--minimal');
    if (input.framework) args.push('--framework', input.framework as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow initialized' });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow failed',
      ErrorCodes.LUMENFLOW_ALIAS_ERROR,
    );
  },
};

/**
 * lumenflow_gates - Public gates alias
 */
export const lumenflowGatesTool: ToolDefinition = {
  name: 'lumenflow_gates',
  description: 'Run quality gates (lumenflow-gates alias)',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input);
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || SuccessMessages.ALL_GATES_PASSED });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow-gates failed',
      ErrorCodes.LUMENFLOW_GATES_ERROR,
    );
  },
};

/**
 * state_bootstrap - Bootstrap event store from WU YAMLs
 */
export const stateBootstrapTool: ToolDefinition = {
  name: 'state_bootstrap',
  description: 'Bootstrap state store from existing WU YAML files',
  inputSchema: stateBootstrapSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.execute) args.push('--execute');
    if (input.dry_run) args.push('--dry-run');
    if (input.force) args.push('--force');
    if (input.wu_dir) args.push('--wu-dir', input.wu_dir as string);
    if (input.state_dir) args.push('--state-dir', input.state_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:bootstrap', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State bootstrap complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:bootstrap failed',
      ErrorCodes.STATE_BOOTSTRAP_ERROR,
    );
  },
};

/**
 * state_cleanup - Run unified state cleanup
 */
export const stateCleanupTool: ToolDefinition = {
  name: 'state_cleanup',
  description: 'Clean stale state, memory, and signal data',
  inputSchema: stateCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.signals_only) args.push('--signals-only');
    if (input.memory_only) args.push('--memory-only');
    if (input.events_only) args.push('--events-only');
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State cleanup complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:cleanup failed',
      ErrorCodes.STATE_CLEANUP_ERROR,
    );
  },
};

/**
 * state_doctor - Diagnose and repair state issues
 */
export const stateDoctorTool: ToolDefinition = {
  name: 'state_doctor',
  description: 'Diagnose state store integrity issues',
  inputSchema: stateDoctorSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.fix) args.push('--fix');
    if (input.dry_run) args.push('--dry-run');
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:doctor', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State doctor complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:doctor failed',
      ErrorCodes.STATE_DOCTOR_ERROR,
    );
  },
};

/**
 * sync_templates - Sync templates from source docs
 */
export const syncTemplatesTool: ToolDefinition = {
  name: 'sync_templates',
  description: 'Sync internal docs to CLI templates',
  inputSchema: syncTemplatesMcpSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.verbose) args.push('--verbose');
    if (input.check_drift) args.push('--check-drift');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('sync:templates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Template sync complete' });
    }
    return error(
      result.stderr || result.error?.message || 'sync:templates failed',
      ErrorCodes.SYNC_TEMPLATES_ALIAS_ERROR,
    );
  },
};

// ============================================================================
// Wave-2 Public Parity Operations (WU-1483)
// ============================================================================

/**
 * file_read - Read file content with audit trail
 */
export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description: 'Read a file with optional line ranges and encoding',
  inputSchema: fileReadSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.start_line !== undefined) args.push('--start-line', String(input.start_line));
    if (input.end_line !== undefined) args.push('--end-line', String(input.end_line));
    if (input.max_size !== undefined) args.push('--max-size', String(input.max_size));

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:read', args, cliOptions);

    if (result.success) {
      return success({ content: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'file:read failed',
      ErrorCodes.FILE_READ_ERROR,
    );
  },
};

/**
 * file_write - Write file content with audit trail
 */
export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description: 'Write content to a file with audit trail',
  inputSchema: fileWriteSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.content === undefined) {
      return error(ErrorMessages.CONTENT_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string, '--content', input.content as string];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.no_create_dirs) args.push('--no-create-dirs');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:write', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'File written' });
    }
    return error(
      result.stderr || result.error?.message || 'file:write failed',
      ErrorCodes.FILE_WRITE_ERROR,
    );
  },
};

/**
 * file_edit - Replace exact string matches in a file
 */
export const fileEditTool: ToolDefinition = {
  name: 'file_edit',
  description: 'Edit a file via exact string replacement',
  inputSchema: fileEditSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.old_string) {
      return error(ErrorMessages.OLD_STRING_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.new_string === undefined) {
      return error(ErrorMessages.NEW_STRING_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [
      '--path',
      input.path as string,
      '--old-string',
      input.old_string as string,
      '--new-string',
      input.new_string as string,
    ];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.replace_all) args.push('--replace-all');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'File edited' });
    }
    return error(
      result.stderr || result.error?.message || 'file:edit failed',
      ErrorCodes.FILE_EDIT_ERROR,
    );
  },
};

/**
 * file_delete - Delete file or directory with audit trail
 */
export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete',
  description: 'Delete files or directories with safety flags',
  inputSchema: fileDeleteSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string];
    if (input.recursive) args.push('--recursive');
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:delete', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Delete complete' });
    }
    return error(
      result.stderr || result.error?.message || 'file:delete failed',
      ErrorCodes.FILE_DELETE_ERROR,
    );
  },
};

/**
 * git_status - Show git status
 */
export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Show git status with optional porcelain/short modes',
  inputSchema: gitStatusSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.porcelain) args.push('--porcelain');
    if (input.short) args.push('--short');
    if (input.path) args.push(input.path as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:status', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:status failed',
      ErrorCodes.GIT_STATUS_ERROR,
    );
  },
};

/**
 * git_diff - Show git diff
 */
export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show git diff with staged/name-only/stat modes',
  inputSchema: gitDiffSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.staged) args.push('--staged');
    if (input.name_only) args.push('--name-only');
    if (input.stat) args.push('--stat');
    if (input.ref) args.push(input.ref as string);
    if (input.path) args.push('--', input.path as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:diff', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:diff failed',
      ErrorCodes.GIT_DIFF_ERROR,
    );
  },
};

/**
 * git_log - Show commit history
 */
export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: 'Show git commit log with filters',
  inputSchema: gitLogSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.oneline) args.push('--oneline');
    if (input.max_count !== undefined) args.push('-n', String(input.max_count));
    if (input.format) args.push('--format', input.format as string);
    if (input.since) args.push('--since', input.since as string);
    if (input.author) args.push('--author', input.author as string);
    if (input.ref) args.push(input.ref as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:log', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:log failed',
      ErrorCodes.GIT_LOG_ERROR,
    );
  },
};

/**
 * git_branch - Show branch information
 */
export const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  description: 'Show git branch listing and current branch',
  inputSchema: gitBranchSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.list) args.push('--list');
    if (input.all) args.push('--all');
    if (input.remotes) args.push('--remotes');
    if (input.show_current) args.push('--show-current');
    if (input.contains) args.push('--contains', input.contains as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:branch', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:branch failed',
      ErrorCodes.GIT_BRANCH_ERROR,
    );
  },
};

/**
 * init_plan - Link plan to initiative (alias)
 */
export const initPlanTool: ToolDefinition = {
  name: 'init_plan',
  description: 'Link or create a plan for an initiative',
  inputSchema: initiativePlanSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(SharedErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.plan && !input.create) {
      return error(ErrorMessages.PLAN_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--initiative', input.initiative as string];
    if (input.plan) args.push('--plan', input.plan as string);
    if (input.create) args.push('--create');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('init:plan', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan linked' });
    }
    return error(
      result.stderr || result.error?.message || 'init:plan failed',
      ErrorCodes.INIT_PLAN_ERROR,
    );
  },
};

/**
 * plan_create - Create a plan file
 */
export const planCreateTool: ToolDefinition = {
  name: 'plan_create',
  description: 'Create a new plan for a WU or initiative',
  inputSchema: planCreateSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--title', input.title as string];
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:create', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan created' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:create failed',
      ErrorCodes.PLAN_CREATE_ERROR,
    );
  },
};

/**
 * plan_edit - Edit an existing plan section
 */
export const planEditTool: ToolDefinition = {
  name: 'plan_edit',
  description: 'Edit or append content to a plan section',
  inputSchema: planEditSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.section) {
      return error(ErrorMessages.SECTION_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.content && !input.append) {
      return error(ErrorMessages.CONTENT_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--section', input.section as string];
    if (input.content) args.push('--content', input.content as string);
    if (input.append) args.push('--append', input.append as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan edited' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:edit failed',
      ErrorCodes.PLAN_EDIT_ERROR,
    );
  },
};

/**
 * plan_link - Link plan URI to WU/initiative
 */
export const planLinkTool: ToolDefinition = {
  name: 'plan_link',
  description: 'Link an existing plan URI to a WU or initiative',
  inputSchema: planLinkSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.plan) {
      return error(ErrorMessages.PLAN_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--plan', input.plan as string];
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:link', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan linked' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:link failed',
      ErrorCodes.PLAN_LINK_ERROR,
    );
  },
};

/**
 * plan_promote - Promote plan to approved status
 */
export const planPromoteTool: ToolDefinition = {
  name: 'plan_promote',
  description: 'Promote plan from draft to approved status',
  inputSchema: planPromoteSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:promote', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan promoted' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:promote failed',
      ErrorCodes.PLAN_PROMOTE_ERROR,
    );
  },
};

/**
 * signal_cleanup - Clean stale signals
 */
export const signalCleanupTool: ToolDefinition = {
  name: 'signal_cleanup',
  description: 'Cleanup stale signals using TTL policy',
  inputSchema: signalCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.ttl) args.push('--ttl', input.ttl as string);
    if (input.unread_ttl) args.push('--unread-ttl', input.unread_ttl as string);
    if (input.max_entries !== undefined) args.push('--max-entries', String(input.max_entries));
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('signal:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Signal cleanup complete' });
    }
    return error(
      result.stderr || result.error?.message || 'signal:cleanup failed',
      ErrorCodes.SIGNAL_CLEANUP_ERROR,
    );
  },
};

/**
 * wu_proto - Create and claim a prototype WU
 */
export const wuProtoTool: ToolDefinition = {
  name: 'wu_proto',
  description: 'Create and claim a prototype WU with relaxed validation',
  inputSchema: wuProtoSchema,

  async execute(input, options) {
    if (!input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--lane', input.lane as string, '--title', input.title as string];
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (Array.isArray(input.code_paths)) {
      for (const codePath of input.code_paths) {
        args.push(CliArgs.CODE_PATHS, String(codePath));
      }
    }
    if (Array.isArray(input.labels) && input.labels.length > 0) {
      args.push('--labels', input.labels.join(','));
    }
    if (input.assigned_to) args.push('--assigned-to', input.assigned_to as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:proto', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Prototype WU created' });
    }
    return error(
      result.stderr || result.error?.message || 'wu:proto failed',
      ErrorCodes.WU_PROTO_ERROR,
    );
  },
};
