import path from 'node:path';
import {
  TOOL_HANDLER_KINDS,
  type ExecutionContext,
  type RuntimeToolCapabilityResolverInput,
} from '@lumenflow/kernel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isInProcessPackToolRegistered,
  listInProcessPackTools,
  packToolCapabilityResolver,
} from '../runtime-tool-resolver.js';
import { getSoftwareDeliveryMigrationScorecard } from '../../../packs/software-delivery/manifest.js';
import {
  buildExecutionContext,
  executeViaPack,
  resetExecuteViaPackRuntimeCache,
} from '../tools-shared.js';

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};
const FILE_TOOL_NAMES = {
  READ: 'file:read',
  WRITE: 'file:write',
  EDIT: 'file:edit',
  DELETE: 'file:delete',
} as const;
const STATE_SIGNAL_TOOL_NAMES = {
  BACKLOG_PRUNE: 'backlog:prune',
  STATE_BOOTSTRAP: 'state:bootstrap',
  STATE_CLEANUP: 'state:cleanup',
  STATE_DOCTOR: 'state:doctor',
  SIGNAL_CLEANUP: 'signal:cleanup',
} as const;
const ORCHESTRATION_QUERY_TOOL_NAMES = {
  INIT_STATUS: 'orchestrate:init-status',
  MONITOR: 'orchestrate:monitor',
  DELEGATION_LIST: 'delegation:list',
} as const;
const WU_1887_CORE_LIFECYCLE_TOOLS = {
  STATUS: 'wu:status',
  CREATE: 'wu:create',
  CLAIM: 'wu:claim',
  DONE: 'wu:done',
  PREP: 'wu:prep',
  PREFLIGHT: 'wu:preflight',
  VALIDATE: 'wu:validate',
  GATES: 'gates',
} as const;
const WU_1895_CLEANUP_ADMIN_TOOLS = {
  SANDBOX: 'wu:sandbox',
  PRUNE: 'wu:prune',
  DELETE: 'wu:delete',
  CLEANUP: 'wu:cleanup',
  UNLOCK_LANE: 'wu:unlock-lane',
} as const;
const WU_1893_STATE_TRANSITION_TOOLS = {
  BLOCK: 'wu:block',
  UNBLOCK: 'wu:unblock',
  RELEASE: 'wu:release',
  RECOVER: 'wu:recover',
  REPAIR: 'wu:repair',
} as const;
const WU_1894_DELEGATION_CONTEXT_TOOLS = {
  BRIEF: 'wu:brief',
  DELEGATE: 'wu:delegate',
  DEPS: 'wu:deps',
  EDIT: 'wu:edit',
  PROTO: 'wu:proto',
} as const;
const INITIATIVE_ORCHESTRATION_TOOL_NAMES = {
  LIST: 'initiative:list',
  STATUS: 'initiative:status',
  CREATE: 'initiative:create',
  EDIT: 'initiative:edit',
  ADD_WU: 'initiative:add-wu',
  REMOVE_WU: 'initiative:remove-wu',
  BULK_ASSIGN: 'initiative:bulk-assign',
  PLAN: 'initiative:plan',
  INIT_PLAN: 'init:plan',
  ORCHESTRATE_INITIATIVE: 'orchestrate:initiative',
} as const;
const MEMORY_TOOL_NAMES = {
  INIT: 'mem:init',
  START: 'mem:start',
  READY: 'mem:ready',
  CHECKPOINT: 'mem:checkpoint',
  CLEANUP: 'mem:cleanup',
  CONTEXT: 'mem:context',
  CREATE: 'mem:create',
  DELETE: 'mem:delete',
  EXPORT: 'mem:export',
  INBOX: 'mem:inbox',
  SIGNAL: 'mem:signal',
  SUMMARIZE: 'mem:summarize',
  TRIAGE: 'mem:triage',
  RECOVER: 'mem:recover',
} as const;
const WU_1903_AGENT_TOOLS = {
  AGENT_SESSION: 'agent:session',
  AGENT_SESSION_END: 'agent:session-end',
  AGENT_LOG_ISSUE: 'agent:log-issue',
  AGENT_ISSUES_QUERY: 'agent:issues-query',
} as const;
const SETUP_COORDINATION_PLAN_TOOL_NAMES = {
  LUMENFLOW: 'lumenflow',
  LUMENFLOW_DOCTOR: 'lumenflow:doctor',
  LUMENFLOW_INTEGRATE: 'lumenflow:integrate',
  LUMENFLOW_UPGRADE: 'lumenflow:upgrade',
  LUMENFLOW_RELEASE: 'lumenflow:release',
  DOCS_SYNC: 'docs:sync',
  SYNC_TEMPLATES: 'sync:templates',
  PLAN_CREATE: 'plan:create',
  PLAN_EDIT: 'plan:edit',
  PLAN_LINK: 'plan:link',
  PLAN_PROMOTE: 'plan:promote',
} as const;
const WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES = {
  WU_INFER_LANE: 'tool-impl/parity-migration-tools.ts#wuInferLaneTool',
  LANE_HEALTH: 'tool-impl/parity-migration-tools.ts#laneHealthTool',
  LANE_SUGGEST: 'tool-impl/parity-migration-tools.ts#laneSuggestTool',
  FILE_READ: 'tool-impl/parity-migration-tools.ts#fileReadTool',
  FILE_WRITE: 'tool-impl/parity-migration-tools.ts#fileWriteTool',
  FILE_EDIT: 'tool-impl/parity-migration-tools.ts#fileEditTool',
  FILE_DELETE: 'tool-impl/parity-migration-tools.ts#fileDeleteTool',
  GIT_BRANCH: 'tool-impl/parity-migration-tools.ts#gitBranchTool',
  GIT_DIFF: 'tool-impl/parity-migration-tools.ts#gitDiffTool',
  GIT_LOG: 'tool-impl/parity-migration-tools.ts#gitLogTool',
  STATE_BOOTSTRAP: 'tool-impl/parity-migration-tools.ts#stateBootstrapTool',
  STATE_CLEANUP: 'tool-impl/parity-migration-tools.ts#stateCleanupTool',
  STATE_DOCTOR: 'tool-impl/parity-migration-tools.ts#stateDoctorTool',
  BACKLOG_PRUNE: 'tool-impl/parity-migration-tools.ts#backlogPruneTool',
  SIGNAL_CLEANUP: 'tool-impl/parity-migration-tools.ts#signalCleanupTool',
  VALIDATE: 'tool-impl/parity-migration-tools.ts#validateTool',
  VALIDATE_AGENT_SKILLS: 'tool-impl/parity-migration-tools.ts#validateAgentSkillsTool',
  VALIDATE_AGENT_SYNC: 'tool-impl/parity-migration-tools.ts#validateAgentSyncTool',
  VALIDATE_BACKLOG_SYNC: 'tool-impl/parity-migration-tools.ts#validateBacklogSyncTool',
  VALIDATE_SKILLS_SPEC: 'tool-impl/parity-migration-tools.ts#validateSkillsSpecTool',
} as const;

function createResolverInput(
  toolName: string,
  entry = 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
): RuntimeToolCapabilityResolverInput {
  return {
    workspaceSpec: {
      id: 'workspace-runtime-resolver-tests',
      name: 'Runtime Resolver Tests',
      packs: [
        {
          id: 'software-delivery',
          version: '0.1.0',
          integrity: 'dev',
          source: 'local',
        },
      ],
      lanes: [
        {
          id: 'framework-core-lifecycle',
          title: 'Framework Core Lifecycle',
          allowed_scopes: [READ_SCOPE],
        },
      ],
      security: {
        allowed_scopes: [READ_SCOPE],
        network_default: 'off',
        deny_overlays: [],
      },
      memory_namespace: 'mem',
      event_namespace: 'evt',
    },
    loadedPack: {
      pin: {
        id: 'software-delivery',
        version: '0.1.0',
        integrity: 'dev',
        source: 'local',
      },
      manifest: {
        id: 'software-delivery',
        version: '0.1.0',
        task_types: ['work-unit'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
      },
      packRoot: path.resolve('/tmp/lumenflow-runtime-resolver-tests/software-delivery'),
      integrity: 'test-integrity',
    },
    tool: {
      name: toolName,
      entry,
      permission: 'read',
      required_scopes: [READ_SCOPE],
    },
  };
}

describe('packToolCapabilityResolver', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('returns in-process capability for registered tools', async () => {
    const input = createResolverInput('context:get');
    const capability = await packToolCapabilityResolver(input);

    expect(capability).toBeDefined();
    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(true);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(capability?.permission).toBe('read');
    expect(capability?.required_scopes).toEqual([READ_SCOPE]);

    const executionContext: ExecutionContext = {
      run_id: 'run-wu-status-1',
      task_id: 'WU-1797',
      session_id: 'session-runtime-resolver-tests',
      allowed_scopes: [READ_SCOPE],
    };

    expect(capability?.handler.fn).toBeTypeOf('function');
    expect(executionContext.task_id).toBe('WU-1797');
  });

  it('lists registered in-process pack tools', () => {
    expect(listInProcessPackTools()).toContain('context:get');
  });

  it('reports scorecard totals that are internally consistent', () => {
    const scorecard = getSoftwareDeliveryMigrationScorecard();

    expect(scorecard.declaredTools).toBeGreaterThan(0);
    expect(scorecard.pendingRuntimeEntries).toBeGreaterThanOrEqual(0);
    expect(scorecard.realHandlerEntries).toBeGreaterThanOrEqual(0);
    expect(scorecard.pendingRuntimeEntries + scorecard.realHandlerEntries).toBe(
      scorecard.declaredTools,
    );
  });

  it('resolves WU-1890 file/git/state/backlog/signal tools to subprocess handlers', async () => {
    const toolEntries = [
      {
        name: FILE_TOOL_NAMES.READ,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.FILE_READ,
      },
      {
        name: FILE_TOOL_NAMES.WRITE,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.FILE_WRITE,
      },
      {
        name: FILE_TOOL_NAMES.EDIT,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.FILE_EDIT,
      },
      {
        name: FILE_TOOL_NAMES.DELETE,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.FILE_DELETE,
      },
      {
        name: 'git:branch',
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.GIT_BRANCH,
      },
      {
        name: 'git:diff',
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.GIT_DIFF,
      },
      {
        name: 'git:log',
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.GIT_LOG,
      },
      {
        name: STATE_SIGNAL_TOOL_NAMES.BACKLOG_PRUNE,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.BACKLOG_PRUNE,
      },
      {
        name: STATE_SIGNAL_TOOL_NAMES.STATE_BOOTSTRAP,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.STATE_BOOTSTRAP,
      },
      {
        name: STATE_SIGNAL_TOOL_NAMES.STATE_CLEANUP,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.STATE_CLEANUP,
      },
      {
        name: STATE_SIGNAL_TOOL_NAMES.STATE_DOCTOR,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.STATE_DOCTOR,
      },
      {
        name: STATE_SIGNAL_TOOL_NAMES.SIGNAL_CLEANUP,
        entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.SIGNAL_CLEANUP,
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1897 orchestration query tools to subprocess handlers', async () => {
    const toolEntries = [
      {
        name: ORCHESTRATION_QUERY_TOOL_NAMES.INIT_STATUS,
        entry: 'tool-impl/initiative-orchestration-tools.ts#orchestrateInitStatusTool',
      },
      {
        name: ORCHESTRATION_QUERY_TOOL_NAMES.MONITOR,
        entry: 'tool-impl/initiative-orchestration-tools.ts#orchestrateMonitorTool',
      },
      {
        name: ORCHESTRATION_QUERY_TOOL_NAMES.DELEGATION_LIST,
        entry: 'tool-impl/initiative-orchestration-tools.ts#delegationListTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1887 core lifecycle tools to subprocess pack handlers', async () => {
    const toolEntries = [
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.STATUS,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuStatusTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.CREATE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuCreateTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.CLAIM,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuClaimTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.DONE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuDoneTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.PREP,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuPrepTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.PREFLIGHT,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuPreflightTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.VALIDATE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuValidateTool',
      },
      {
        name: WU_1887_CORE_LIFECYCLE_TOOLS.GATES,
        entry: 'tool-impl/wu-lifecycle-tools.ts#gatesTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1893 state transition maintenance tools to subprocess pack handlers', async () => {
    const toolEntries = [
      {
        name: WU_1893_STATE_TRANSITION_TOOLS.BLOCK,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuBlockTool',
      },
      {
        name: WU_1893_STATE_TRANSITION_TOOLS.UNBLOCK,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuUnblockTool',
      },
      {
        name: WU_1893_STATE_TRANSITION_TOOLS.RELEASE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuReleaseTool',
      },
      {
        name: WU_1893_STATE_TRANSITION_TOOLS.RECOVER,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuRecoverTool',
      },
      {
        name: WU_1893_STATE_TRANSITION_TOOLS.REPAIR,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuRepairTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1894 delegation/context tools to subprocess pack handlers', async () => {
    const toolEntries = [
      {
        name: WU_1894_DELEGATION_CONTEXT_TOOLS.BRIEF,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuBriefTool',
      },
      {
        name: WU_1894_DELEGATION_CONTEXT_TOOLS.DELEGATE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuDelegateTool',
      },
      {
        name: WU_1894_DELEGATION_CONTEXT_TOOLS.DEPS,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuDepsTool',
      },
      {
        name: WU_1894_DELEGATION_CONTEXT_TOOLS.EDIT,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuEditTool',
      },
      {
        name: WU_1894_DELEGATION_CONTEXT_TOOLS.PROTO,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuProtoTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1895 cleanup/admin tools to subprocess pack handlers', async () => {
    const toolEntries = [
      {
        name: WU_1895_CLEANUP_ADMIN_TOOLS.SANDBOX,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuSandboxTool',
      },
      {
        name: WU_1895_CLEANUP_ADMIN_TOOLS.PRUNE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuPruneTool',
      },
      {
        name: WU_1895_CLEANUP_ADMIN_TOOLS.DELETE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuDeleteTool',
      },
      {
        name: WU_1895_CLEANUP_ADMIN_TOOLS.CLEANUP,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuCleanupTool',
      },
      {
        name: WU_1895_CLEANUP_ADMIN_TOOLS.UNLOCK_LANE,
        entry: 'tool-impl/wu-lifecycle-tools.ts#wuUnlockLaneTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1897 initiative/orchestration lifecycle tools to subprocess handlers', async () => {
    const toolEntries = [
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.LIST,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeListTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.STATUS,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeStatusTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.CREATE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeCreateTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.EDIT,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeEditTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.ADD_WU,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeAddWuTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.REMOVE_WU,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeRemoveWuTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.BULK_ASSIGN,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativeBulkAssignTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.PLAN,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initiativePlanTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.INIT_PLAN,
        entry: 'tool-impl/initiative-orchestration-tools.ts#initPlanTool',
      },
      {
        name: INITIATIVE_ORCHESTRATION_TOOL_NAMES.ORCHESTRATE_INITIATIVE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#orchestrateInitiativeTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1896 memory tools to subprocess handlers', async () => {
    const toolEntries = [
      { name: MEMORY_TOOL_NAMES.INIT, entry: 'tool-impl/memory-tools.ts#memInitTool' },
      { name: MEMORY_TOOL_NAMES.START, entry: 'tool-impl/memory-tools.ts#memStartTool' },
      { name: MEMORY_TOOL_NAMES.READY, entry: 'tool-impl/memory-tools.ts#memReadyTool' },
      {
        name: MEMORY_TOOL_NAMES.CHECKPOINT,
        entry: 'tool-impl/memory-tools.ts#memCheckpointTool',
      },
      { name: MEMORY_TOOL_NAMES.CLEANUP, entry: 'tool-impl/memory-tools.ts#memCleanupTool' },
      { name: MEMORY_TOOL_NAMES.CONTEXT, entry: 'tool-impl/memory-tools.ts#memContextTool' },
      { name: MEMORY_TOOL_NAMES.CREATE, entry: 'tool-impl/memory-tools.ts#memCreateTool' },
      { name: MEMORY_TOOL_NAMES.DELETE, entry: 'tool-impl/memory-tools.ts#memDeleteTool' },
      { name: MEMORY_TOOL_NAMES.EXPORT, entry: 'tool-impl/memory-tools.ts#memExportTool' },
      { name: MEMORY_TOOL_NAMES.INBOX, entry: 'tool-impl/memory-tools.ts#memInboxTool' },
      { name: MEMORY_TOOL_NAMES.SIGNAL, entry: 'tool-impl/memory-tools.ts#memSignalTool' },
      {
        name: MEMORY_TOOL_NAMES.SUMMARIZE,
        entry: 'tool-impl/memory-tools.ts#memSummarizeTool',
      },
      { name: MEMORY_TOOL_NAMES.TRIAGE, entry: 'tool-impl/memory-tools.ts#memTriageTool' },
      { name: MEMORY_TOOL_NAMES.RECOVER, entry: 'tool-impl/memory-tools.ts#memRecoverTool' },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1903 agent tools to subprocess handlers', async () => {
    const toolEntries = [
      {
        name: WU_1903_AGENT_TOOLS.AGENT_SESSION,
        entry: 'tool-impl/agent-tools.ts#agentSessionTool',
      },
      {
        name: WU_1903_AGENT_TOOLS.AGENT_SESSION_END,
        entry: 'tool-impl/agent-tools.ts#agentSessionEndTool',
      },
      {
        name: WU_1903_AGENT_TOOLS.AGENT_LOG_ISSUE,
        entry: 'tool-impl/agent-tools.ts#agentLogIssueTool',
      },
      {
        name: WU_1903_AGENT_TOOLS.AGENT_ISSUES_QUERY,
        entry: 'tool-impl/agent-tools.ts#agentIssuesQueryTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('resolves WU-1897 setup/coordination/plan lifecycle tools to subprocess handlers', async () => {
    const toolEntries = [
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW,
        entry: 'tool-impl/initiative-orchestration-tools.ts#lumenflowTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_DOCTOR,
        entry: 'tool-impl/initiative-orchestration-tools.ts#lumenflowDoctorTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_INTEGRATE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#lumenflowIntegrateTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_UPGRADE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#lumenflowUpgradeTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_RELEASE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#lumenflowReleaseTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.DOCS_SYNC,
        entry: 'tool-impl/initiative-orchestration-tools.ts#docsSyncTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.SYNC_TEMPLATES,
        entry: 'tool-impl/initiative-orchestration-tools.ts#syncTemplatesTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_CREATE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#planCreateTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_EDIT,
        entry: 'tool-impl/initiative-orchestration-tools.ts#planEditTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_LINK,
        entry: 'tool-impl/initiative-orchestration-tools.ts#planLinkTool',
      },
      {
        name: SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_PROMOTE,
        entry: 'tool-impl/initiative-orchestration-tools.ts#planPromoteTool',
      },
    ] as const;

    for (const toolEntry of toolEntries) {
      const capability = await packToolCapabilityResolver(
        createResolverInput(toolEntry.name, toolEntry.entry),
      );
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      expect(isInProcessPackToolRegistered(toolEntry.name)).toBe(false);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(toolEntry.entry);
      }
    }
  });

  it('falls back to default subprocess capability for unregistered tools', async () => {
    const input = createResolverInput('tool:unknown');
    const capability = await packToolCapabilityResolver(input);

    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(false);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
    if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
      expect(capability.handler.entry).toContain('tool-impl/pending-runtime-tools.ts');
    }
  });

  it('builds a maintenance execution context when task identity is omitted', () => {
    const context = buildExecutionContext({
      now: () => new Date('2026-02-18T00:00:00.000Z'),
    });

    expect(context.task_id).toContain('maintenance');
    expect(context.run_id).toContain(context.task_id);
    expect(context.session_id).toContain('session-maintenance');
    // WU-1859: Maintenance scope narrowed from wildcard write to read-only
    expect(context.allowed_scopes).toEqual([{ type: 'path', pattern: '**', access: 'read' }]);
    expect(context.metadata?.invocation_mode).toBe('maintenance');
  });

  it('builds a task-scoped execution context when task identity is provided', () => {
    const context = buildExecutionContext({
      taskId: 'WU-1798',
      runId: 'run-WU-1798-1',
      sessionId: 'session-WU-1798',
      allowedScopes: [READ_SCOPE],
      metadata: { source: 'unit-test' },
    });

    expect(context.task_id).toBe('WU-1798');
    expect(context.run_id).toBe('run-WU-1798-1');
    expect(context.session_id).toBe('session-WU-1798');
    expect(context.allowed_scopes).toEqual([READ_SCOPE]);
    expect(context.metadata?.invocation_mode).toBe('task');
    expect(context.metadata?.source).toBe('unit-test');
  });

  it('prefers runtime execution in executeViaPack when runtime succeeds', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { via: 'runtime' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'wu:status',
      { id: 'WU-1798' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({
          taskId: 'WU-1798',
          runId: 'run-WU-1798-1',
          sessionId: 'session-WU-1798',
          allowedScopes: [READ_SCOPE],
        }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:status',
          args: ['--id', 'WU-1798'],
          errorCode: 'WU_STATUS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(1);
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.data as { success: boolean }).success).toBe(true);
  });

  it('falls back to CLI execution in executeViaPack when runtime fails', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('runtime unavailable'));
    const cliRunner = vi.fn().mockResolvedValue({
      success: true,
      stdout: 'fallback path',
      stderr: '',
      exitCode: 0,
    });

    const result = await executeViaPack(
      'wu:status',
      { id: 'WU-1798' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:status',
          args: ['--id', 'WU-1798'],
          errorCode: 'WU_STATUS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(cliRunner).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result.data as { message: string }).message).toContain('fallback path');
  });

  it('does not register WU-1890 file tool handlers as in-process', () => {
    expect(isInProcessPackToolRegistered(FILE_TOOL_NAMES.READ)).toBe(false);
    expect(isInProcessPackToolRegistered(FILE_TOOL_NAMES.WRITE)).toBe(false);
    expect(isInProcessPackToolRegistered(FILE_TOOL_NAMES.EDIT)).toBe(false);
    expect(isInProcessPackToolRegistered(FILE_TOOL_NAMES.DELETE)).toBe(false);
  });
});

/**
 * WU-1803 / WU-1905: Tests for context tool in-process handler registration.
 *
 * WU-1905: flow:bottlenecks, flow:report, metrics:snapshot, lumenflow:metrics,
 * and metrics have been migrated to software-delivery pack handlers and are no
 * longer registered as in-process resolver tools.
 */
describe('WU-1803/WU-1905: context tool registration (flow/metrics migrated to pack)', () => {
  const REMAINING_CONTEXT_TOOLS = ['context:get', 'wu:list'] as const;

  it.each(REMAINING_CONTEXT_TOOLS)('registers %s as an in-process pack tool', (toolName) => {
    expect(isInProcessPackToolRegistered(toolName)).toBe(true);
  });

  it('lists remaining context tools in the registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolName of REMAINING_CONTEXT_TOOLS) {
      expect(registeredTools).toContain(toolName);
    }
  });

  it.each(REMAINING_CONTEXT_TOOLS)(
    'resolves %s to an in-process handler via packToolCapabilityResolver',
    async (toolName) => {
      const input = createResolverInput(toolName);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    },
  );

  const MIGRATED_FLOW_METRICS_TOOLS = [
    'flow:bottlenecks',
    'flow:report',
    'metrics:snapshot',
    'lumenflow:metrics',
    'metrics',
  ] as const;

  it.each(MIGRATED_FLOW_METRICS_TOOLS)(
    '%s is no longer registered as in-process (migrated to pack handler)',
    (toolName) => {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
    },
  );

  it.each(MIGRATED_FLOW_METRICS_TOOLS)(
    '%s falls back to subprocess handler via packToolCapabilityResolver',
    async (toolName) => {
      const input = createResolverInput(toolName);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
    },
  );
});

/**
 * WU-1897: orchestration/delegation query tools migrated to pack handlers.
 */
describe('WU-1897: orchestration/delegation query tool migration', () => {
  const ORCHESTRATION_QUERY_TOOLS = [
    ORCHESTRATION_QUERY_TOOL_NAMES.INIT_STATUS,
    ORCHESTRATION_QUERY_TOOL_NAMES.MONITOR,
    ORCHESTRATION_QUERY_TOOL_NAMES.DELEGATION_LIST,
  ] as const;

  it.each(ORCHESTRATION_QUERY_TOOLS)('%s is no longer registered as in-process', (toolName) => {
    expect(isInProcessPackToolRegistered(toolName)).toBe(false);
  });

  it('does not list orchestration/delegation query tools in the in-process registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolName of ORCHESTRATION_QUERY_TOOLS) {
      expect(registeredTools).not.toContain(toolName);
    }
  });

  it.each(ORCHESTRATION_QUERY_TOOLS)(
    'resolves %s to a subprocess handler via packToolCapabilityResolver',
    async (toolName) => {
      const input = createResolverInput(toolName);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
    },
  );
});

/**
 * WU-1890: validation/lane tools migrate off in-process registration
 */
describe('WU-1890: validation/lane tool registration', () => {
  const WU_1890_VALIDATION_LANE_TOOL_ENTRIES = [
    {
      name: 'validate',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.VALIDATE,
    },
    {
      name: 'validate:agent-skills',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.VALIDATE_AGENT_SKILLS,
    },
    {
      name: 'validate:agent-sync',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.VALIDATE_AGENT_SYNC,
    },
    {
      name: 'validate:backlog-sync',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.VALIDATE_BACKLOG_SYNC,
    },
    {
      name: 'validate:skills-spec',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.VALIDATE_SKILLS_SPEC,
    },
    {
      name: 'lane:health',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.LANE_HEALTH,
    },
    {
      name: 'lane:suggest',
      entry: WU_1890_REMAINING_MIGRATION_TOOL_ENTRIES.LANE_SUGGEST,
    },
  ] as const;

  it.each(WU_1890_VALIDATION_LANE_TOOL_ENTRIES)(
    '%s is no longer registered as an in-process pack tool',
    ({ name }) => {
      expect(isInProcessPackToolRegistered(name)).toBe(false);
    },
  );

  it('does not list migrated validation/lane tools in the in-process registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolEntry of WU_1890_VALIDATION_LANE_TOOL_ENTRIES) {
      expect(registeredTools).not.toContain(toolEntry.name);
    }
  });

  it.each(WU_1890_VALIDATION_LANE_TOOL_ENTRIES)(
    'resolves %s to a subprocess handler via packToolCapabilityResolver',
    async ({ name, entry }) => {
      const input = createResolverInput(name, entry);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
      if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
        expect(capability.handler.entry).toContain(entry);
      }
    },
  );
});

/**
 * WU-1802: Tests for validation/lane MCP tools using executeViaPack
 */
describe('WU-1802: validation/lane tools use executeViaPack (not runCliCommand)', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('validate routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'Validation passed' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'validate',
      { strict: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'validate',
          args: ['--strict'],
          errorCode: 'VALIDATE_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledWith(
      'validate',
      { strict: true },
      expect.objectContaining({ task_id: 'WU-1802' }),
    );
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('lane_health routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { overlaps: [], gaps: [] },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'lane:health',
      { json: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'lane:health',
          args: ['--json'],
          errorCode: 'LANE_HEALTH_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('lane_suggest routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { suggestions: [] },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'lane:suggest',
      { no_llm: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'lane:suggest',
          args: ['--no-llm'],
          errorCode: 'LANE_SUGGEST_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('validate_backlog_sync routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'Backlog sync valid' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'validate:backlog-sync',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'validate:backlog-sync',
          args: [],
          errorCode: 'VALIDATE_BACKLOG_SYNC_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

/**
 * WU-1803: Tests for flow/metrics/context MCP tools using executeViaPack.
 *
 * WU-1905: The resolver stubs for flow/metrics tools have been removed, but
 * these tests remain valid because they test the executeViaPack mechanism with
 * mock runtimes. The pack handler implementations now live in
 * packages/@lumenflow/packs/software-delivery/tool-impl/flow-metrics-tools.ts.
 */
describe('WU-1803: flow/metrics/context tools use executeViaPack (not runCliCommand)', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('flow_bottlenecks routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { bottlenecks: [], criticalPath: { path: [], length: 0 } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'flow:bottlenecks',
      { limit: 10 },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'flow:bottlenecks',
          args: ['--limit', '10'],
          errorCode: 'FLOW_BOTTLENECKS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledWith(
      'flow:bottlenecks',
      { limit: 10 },
      expect.objectContaining({ task_id: 'WU-1803' }),
    );
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('flow_report routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { range: { start: '2026-01-01', end: '2026-02-01' } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'flow:report',
      { days: 30 },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'flow:report',
          args: ['--days', '30'],
          errorCode: 'FLOW_REPORT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('metrics_snapshot routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { flow: { ready: 5, inProgress: 2, blocked: 1, waiting: 0, done: 10, totalActive: 8 } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'metrics:snapshot',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'metrics:snapshot',
          args: [],
          errorCode: 'METRICS_SNAPSHOT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('context_get routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { location: { type: 'main' } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'context:get',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'context:get',
          args: [],
          errorCode: 'CONTEXT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('wu_list routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'WU-1803', status: 'in_progress' }],
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'wu:list',
      { status: 'in_progress' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:validate',
          args: ['--all', '--json'],
          errorCode: 'WU_LIST_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('WU-1808: completion/cleanup lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs create -> claim -> prep -> done via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'wu:create',
        input: { lane: 'Framework: Core Lifecycle', title: 'Lifecycle fixture' },
        fallback: {
          command: 'wu:create',
          args: ['--lane', 'Framework: Core Lifecycle', '--title', 'Lifecycle fixture'],
          errorCode: 'WU_CREATE_ERROR',
        },
      },
      {
        toolName: 'wu:claim',
        input: { id: 'WU-1808', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'wu:claim',
          args: ['--id', 'WU-1808', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'WU_CLAIM_ERROR',
        },
      },
      {
        toolName: 'wu:prep',
        input: { id: 'WU-1808' },
        fallback: {
          command: 'wu:prep',
          args: ['--id', 'WU-1808'],
          errorCode: 'WU_PREP_ERROR',
        },
      },
      {
        toolName: 'wu:done',
        input: { id: 'WU-1808' },
        fallback: {
          command: 'wu:done',
          args: ['--id', 'WU-1808'],
          errorCode: 'WU_DONE_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1808' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1809: delegation/gates lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs brief -> delegate -> unlock-lane -> gates via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'wu:brief',
        input: { id: 'WU-1809' },
        fallback: {
          command: 'wu:brief',
          args: ['--id', 'WU-1809'],
          errorCode: 'WU_BRIEF_ERROR',
        },
      },
      {
        toolName: 'wu:delegate',
        input: { id: 'WU-1809', parent_wu: 'WU-1808' },
        fallback: {
          command: 'wu:delegate',
          args: ['--id', 'WU-1809', '--parent-wu', 'WU-1808'],
          errorCode: 'WU_DELEGATE_ERROR',
        },
      },
      {
        toolName: 'wu:unlock-lane',
        input: { lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'wu:unlock-lane',
          args: ['--lane', 'Framework: Core Lifecycle'],
          errorCode: 'WU_UNLOCK_LANE_ERROR',
        },
      },
      {
        toolName: 'gates',
        input: { docs_only: true },
        fallback: {
          command: 'gates',
          args: ['--docs-only'],
          errorCode: 'GATES_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1809' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1810: initiative/orchestration lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs initiative and orchestrate tools via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'initiative:list',
        input: {},
        fallback: {
          command: 'initiative:list',
          args: [],
          errorCode: 'INITIATIVE_LIST_ERROR',
        },
      },
      {
        toolName: 'initiative:status',
        input: { id: 'INIT-030' },
        fallback: {
          command: 'initiative:status',
          args: ['--id', 'INIT-030'],
          errorCode: 'INITIATIVE_STATUS_ERROR',
        },
      },
      {
        toolName: 'initiative:create',
        input: {
          id: 'INIT-030',
          slug: 'kernel-runtime-adoption',
          title: 'KernelRuntime Adoption',
        },
        fallback: {
          command: 'initiative:create',
          args: [
            '--id',
            'INIT-030',
            '--slug',
            'kernel-runtime-adoption',
            '--title',
            'KernelRuntime Adoption',
          ],
          errorCode: 'INITIATIVE_CREATE_ERROR',
        },
      },
      {
        toolName: 'initiative:edit',
        input: { id: 'INIT-030', description: 'updated' },
        fallback: {
          command: 'initiative:edit',
          args: ['--id', 'INIT-030', '--description', 'updated'],
          errorCode: 'INITIATIVE_EDIT_ERROR',
        },
      },
      {
        toolName: 'initiative:add-wu',
        input: { initiative: 'INIT-030', wu: 'WU-1810' },
        fallback: {
          command: 'initiative:add-wu',
          args: ['--initiative', 'INIT-030', '--wu', 'WU-1810'],
          errorCode: 'INITIATIVE_ADD_WU_ERROR',
        },
      },
      {
        toolName: 'initiative:remove-wu',
        input: { initiative: 'INIT-030', wu: 'WU-1810' },
        fallback: {
          command: 'initiative:remove-wu',
          args: ['--initiative', 'INIT-030', '--wu', 'WU-1810'],
          errorCode: 'INITIATIVE_REMOVE_WU_ERROR',
        },
      },
      {
        toolName: 'initiative:bulk-assign',
        input: { apply: true },
        fallback: {
          command: 'initiative:bulk-assign',
          args: ['--apply'],
          errorCode: 'INITIATIVE_BULK_ASSIGN_ERROR',
        },
      },
      {
        toolName: 'initiative:plan',
        input: { initiative: 'INIT-030', create: true },
        fallback: {
          command: 'initiative:plan',
          args: ['--initiative', 'INIT-030', '--create'],
          errorCode: 'INITIATIVE_PLAN_ERROR',
        },
      },
      {
        toolName: 'init:plan',
        input: { initiative: 'INIT-030', create: true },
        fallback: {
          command: 'init:plan',
          args: ['--initiative', 'INIT-030', '--create'],
          errorCode: 'INIT_PLAN_ERROR',
        },
      },
      {
        toolName: 'orchestrate:initiative',
        input: { initiative: 'INIT-030', dry_run: true },
        fallback: {
          command: 'orchestrate:initiative',
          args: ['--initiative', 'INIT-030', '--dry-run'],
          errorCode: 'ORCHESTRATE_INITIATIVE_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1810' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1811: memory lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs mem_* tools via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'mem:init',
        input: { wu: 'WU-1811' },
        fallback: {
          command: 'mem:init',
          args: ['--wu', 'WU-1811'],
          errorCode: 'MEM_INIT_ERROR',
        },
      },
      {
        toolName: 'mem:start',
        input: { wu: 'WU-1811', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'mem:start',
          args: ['--wu', 'WU-1811', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'MEM_START_ERROR',
        },
      },
      {
        toolName: 'mem:ready',
        input: { wu: 'WU-1811' },
        fallback: {
          command: 'mem:ready',
          args: ['--wu', 'WU-1811'],
          errorCode: 'MEM_READY_ERROR',
        },
      },
      {
        toolName: 'mem:checkpoint',
        input: { wu: 'WU-1811', message: 'Checkpoint before gates' },
        fallback: {
          command: 'mem:checkpoint',
          args: ['--wu', 'WU-1811', '--message', 'Checkpoint before gates'],
          errorCode: 'MEM_CHECKPOINT_ERROR',
        },
      },
      {
        toolName: 'mem:cleanup',
        input: { dry_run: true },
        fallback: {
          command: 'mem:cleanup',
          args: ['--dry-run'],
          errorCode: 'MEM_CLEANUP_ERROR',
        },
      },
      {
        toolName: 'mem:context',
        input: { wu: 'WU-1811', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'mem:context',
          args: ['--wu', 'WU-1811', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'MEM_CONTEXT_ERROR',
        },
      },
      {
        toolName: 'mem:create',
        input: {
          message: 'Bug: parser drift',
          wu: 'WU-1811',
          type: 'discovery',
          tags: ['bug', 'scope-creep'],
        },
        fallback: {
          command: 'mem:create',
          args: [
            'Bug: parser drift',
            '--wu',
            'WU-1811',
            '--type',
            'discovery',
            '--tags',
            'bug,scope-creep',
          ],
          errorCode: 'MEM_CREATE_ERROR',
        },
      },
      {
        toolName: 'mem:delete',
        input: { id: 'mem-123' },
        fallback: {
          command: 'mem:delete',
          args: ['--id', 'mem-123'],
          errorCode: 'MEM_DELETE_ERROR',
        },
      },
      {
        toolName: 'mem:export',
        input: { wu: 'WU-1811', format: 'json' },
        fallback: {
          command: 'mem:export',
          args: ['--wu', 'WU-1811', '--format', 'json'],
          errorCode: 'MEM_EXPORT_ERROR',
        },
      },
      {
        toolName: 'mem:inbox',
        input: { since: '30m', wu: 'WU-1811', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'mem:inbox',
          args: ['--since', '30m', '--wu', 'WU-1811', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'MEM_INBOX_ERROR',
        },
      },
      {
        toolName: 'mem:signal',
        input: { message: 'AC complete', wu: 'WU-1811' },
        fallback: {
          command: 'mem:signal',
          args: ['AC complete', '--wu', 'WU-1811'],
          errorCode: 'MEM_SIGNAL_ERROR',
        },
      },
      {
        toolName: 'mem:summarize',
        input: { wu: 'WU-1811' },
        fallback: {
          command: 'mem:summarize',
          args: ['--wu', 'WU-1811'],
          errorCode: 'MEM_SUMMARIZE_ERROR',
        },
      },
      {
        toolName: 'mem:triage',
        input: { wu: 'WU-1811', promote: 'mem-123', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'mem:triage',
          args: ['--wu', 'WU-1811', '--promote', 'mem-123', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'MEM_TRIAGE_ERROR',
        },
      },
      {
        toolName: 'mem:recover',
        input: { wu: 'WU-1811', max_size: 1024, format: 'json', quiet: true, base_dir: '/tmp' },
        fallback: {
          command: 'mem:recover',
          args: [
            '--wu',
            'WU-1811',
            '--max-size',
            '1024',
            '--format',
            'json',
            '--quiet',
            '--base-dir',
            '/tmp',
          ],
          errorCode: 'MEM_RECOVER_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1811' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1812: setup/coordination/plan lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs remaining agent/setup/plan/docs/sync tools via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'agent:session',
        input: { wu: 'WU-1812', tier: 2 },
        fallback: {
          command: 'agent:session',
          args: ['--wu', 'WU-1812', '--tier', '2'],
          errorCode: 'AGENT_SESSION_ERROR',
        },
      },
      {
        toolName: 'agent:session-end',
        input: {},
        fallback: {
          command: 'agent:session-end',
          args: [],
          errorCode: 'AGENT_SESSION_END_ERROR',
        },
      },
      {
        toolName: 'agent:log-issue',
        input: {
          category: 'workflow',
          severity: 'minor',
          title: 'Issue',
          description: 'desc',
        },
        fallback: {
          command: 'agent:log-issue',
          args: [
            '--category',
            'workflow',
            '--severity',
            'minor',
            '--title',
            'Issue',
            '--description',
            'desc',
          ],
          errorCode: 'AGENT_LOG_ISSUE_ERROR',
        },
      },
      {
        toolName: 'agent:issues-query',
        input: { since: 30 },
        fallback: {
          command: 'agent:issues-query',
          args: ['summary', '--since', '30'],
          errorCode: 'AGENT_ISSUES_QUERY_ERROR',
        },
      },
      {
        toolName: 'lumenflow',
        input: { client: 'codex', merge: true },
        fallback: {
          command: 'lumenflow',
          args: ['--client', 'codex', '--merge'],
          errorCode: 'LUMENFLOW_INIT_ERROR',
        },
      },
      {
        toolName: 'lumenflow',
        input: {},
        fallback: {
          command: 'lumenflow',
          args: ['commands'],
          errorCode: 'LUMENFLOW_COMMANDS_ERROR',
        },
      },
      {
        toolName: 'lumenflow:doctor',
        input: {},
        fallback: {
          command: 'lumenflow:doctor',
          args: [],
          errorCode: 'LUMENFLOW_DOCTOR_ERROR',
        },
      },
      {
        toolName: 'lumenflow:integrate',
        input: { client: 'claude-code' },
        fallback: {
          command: 'lumenflow:integrate',
          args: ['--client', 'claude-code'],
          errorCode: 'LUMENFLOW_INTEGRATE_ERROR',
        },
      },
      {
        toolName: 'lumenflow:upgrade',
        input: {},
        fallback: {
          command: 'lumenflow:upgrade',
          args: [],
          errorCode: 'LUMENFLOW_UPGRADE_ERROR',
        },
      },
      {
        toolName: 'lumenflow:release',
        input: { dry_run: true },
        fallback: {
          command: 'lumenflow:release',
          args: ['--dry-run'],
          errorCode: 'LUMENFLOW_RELEASE_ERROR',
        },
      },
      {
        toolName: 'docs:sync',
        input: { vendor: 'claude', force: true },
        fallback: {
          command: 'docs:sync',
          args: ['--vendor', 'claude', '--force'],
          errorCode: 'DOCS_SYNC_ERROR',
        },
      },
      {
        toolName: 'sync:templates',
        input: { dry_run: true, verbose: true, check_drift: true },
        fallback: {
          command: 'sync:templates',
          args: ['--dry-run', '--verbose', '--check-drift'],
          errorCode: 'SYNC_TEMPLATES_ALIAS_ERROR',
        },
      },
      {
        toolName: 'plan:create',
        input: { id: 'WU-1812', title: 'plan' },
        fallback: {
          command: 'plan:create',
          args: ['--id', 'WU-1812', '--title', 'plan'],
          errorCode: 'PLAN_CREATE_ERROR',
        },
      },
      {
        toolName: 'plan:edit',
        input: { id: 'WU-1812', section: 'goal', append: 'line' },
        fallback: {
          command: 'plan:edit',
          args: ['--id', 'WU-1812', '--section', 'goal', '--append', 'line'],
          errorCode: 'PLAN_EDIT_ERROR',
        },
      },
      {
        toolName: 'plan:link',
        input: { id: 'WU-1812', plan: 'lumenflow://plans/WU-1812.md' },
        fallback: {
          command: 'plan:link',
          args: ['--id', 'WU-1812', '--plan', 'lumenflow://plans/WU-1812.md'],
          errorCode: 'PLAN_LINK_ERROR',
        },
      },
      {
        toolName: 'plan:promote',
        input: { id: 'WU-1812', force: true },
        fallback: {
          command: 'plan:promote',
          args: ['--id', 'WU-1812', '--force'],
          errorCode: 'PLAN_PROMOTE_ERROR',
        },
      },
      {
        toolName: 'wu:recover',
        input: { id: 'WU-1812', action: 'resume' },
        fallback: {
          command: 'wu:recover',
          args: ['--id', 'WU-1812', '--action', 'resume'],
          errorCode: 'WU_RECOVER_ERROR',
        },
      },
      {
        toolName: 'wu:repair',
        input: { id: 'WU-1812', check: true, repair_state: true },
        fallback: {
          command: 'wu:repair',
          args: ['--id', 'WU-1812', '--check', '--repair-state'],
          errorCode: 'WU_REPAIR_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1812' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1893: state-transition maintenance tools migrate off in-process handlers', () => {
  it('does not register migrated state-transition maintenance tools as in-process', () => {
    const migratedTools = [
      WU_1893_STATE_TRANSITION_TOOLS.BLOCK,
      WU_1893_STATE_TRANSITION_TOOLS.UNBLOCK,
      WU_1893_STATE_TRANSITION_TOOLS.RELEASE,
      WU_1893_STATE_TRANSITION_TOOLS.RECOVER,
      WU_1893_STATE_TRANSITION_TOOLS.REPAIR,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});

describe('WU-1894: delegation/context tools migrate off in-process handlers', () => {
  it('does not register migrated delegation/context tools as in-process', () => {
    const migratedTools = [
      WU_1894_DELEGATION_CONTEXT_TOOLS.BRIEF,
      WU_1894_DELEGATION_CONTEXT_TOOLS.DELEGATE,
      WU_1894_DELEGATION_CONTEXT_TOOLS.DEPS,
      WU_1894_DELEGATION_CONTEXT_TOOLS.EDIT,
      WU_1894_DELEGATION_CONTEXT_TOOLS.PROTO,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});

describe('WU-1895: cleanup/admin tools migrate off in-process handlers', () => {
  it('does not register migrated cleanup/admin tools as in-process', () => {
    const migratedTools = [
      WU_1895_CLEANUP_ADMIN_TOOLS.SANDBOX,
      WU_1895_CLEANUP_ADMIN_TOOLS.PRUNE,
      WU_1895_CLEANUP_ADMIN_TOOLS.DELETE,
      WU_1895_CLEANUP_ADMIN_TOOLS.CLEANUP,
      WU_1895_CLEANUP_ADMIN_TOOLS.UNLOCK_LANE,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});

describe('WU-1896: memory tools migrate off in-process handlers', () => {
  it('does not register migrated memory tools as in-process', () => {
    const migratedTools = [
      MEMORY_TOOL_NAMES.INIT,
      MEMORY_TOOL_NAMES.START,
      MEMORY_TOOL_NAMES.READY,
      MEMORY_TOOL_NAMES.CHECKPOINT,
      MEMORY_TOOL_NAMES.CLEANUP,
      MEMORY_TOOL_NAMES.CONTEXT,
      MEMORY_TOOL_NAMES.CREATE,
      MEMORY_TOOL_NAMES.DELETE,
      MEMORY_TOOL_NAMES.EXPORT,
      MEMORY_TOOL_NAMES.INBOX,
      MEMORY_TOOL_NAMES.SIGNAL,
      MEMORY_TOOL_NAMES.SUMMARIZE,
      MEMORY_TOOL_NAMES.TRIAGE,
      MEMORY_TOOL_NAMES.RECOVER,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});

describe('WU-1903: agent integration tools migrate off in-process handlers', () => {
  it('does not register migrated agent tools as in-process', () => {
    const migratedTools = [
      WU_1903_AGENT_TOOLS.AGENT_SESSION,
      WU_1903_AGENT_TOOLS.AGENT_SESSION_END,
      WU_1903_AGENT_TOOLS.AGENT_LOG_ISSUE,
      WU_1903_AGENT_TOOLS.AGENT_ISSUES_QUERY,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});

describe('WU-1897: initiative/plan/setup/orchestration tools migrate off in-process handlers', () => {
  it('does not register migrated initiative/plan/setup/orchestration tools as in-process', () => {
    const migratedTools = [
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.LIST,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.STATUS,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.CREATE,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.EDIT,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.ADD_WU,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.REMOVE_WU,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.BULK_ASSIGN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.PLAN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.INIT_PLAN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.ORCHESTRATE_INITIATIVE,
      ORCHESTRATION_QUERY_TOOL_NAMES.INIT_STATUS,
      ORCHESTRATION_QUERY_TOOL_NAMES.MONITOR,
      ORCHESTRATION_QUERY_TOOL_NAMES.DELEGATION_LIST,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_DOCTOR,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_INTEGRATE,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_UPGRADE,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.LUMENFLOW_RELEASE,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.DOCS_SYNC,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.SYNC_TEMPLATES,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_CREATE,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_EDIT,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_LINK,
      SETUP_COORDINATION_PLAN_TOOL_NAMES.PLAN_PROMOTE,
    ];
    const registeredTools = listInProcessPackTools();

    for (const toolName of migratedTools) {
      expect(isInProcessPackToolRegistered(toolName)).toBe(false);
      expect(registeredTools).not.toContain(toolName);
    }
  });
});
