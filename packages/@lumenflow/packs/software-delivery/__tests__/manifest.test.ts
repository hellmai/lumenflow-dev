import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_DELIVERY_MANIFEST,
  getSoftwareDeliveryMigrationScorecard,
  renderSoftwareDeliveryMigrationScorecard,
} from '../manifest.js';

const PENDING_RUNTIME_TOOL_ENTRY = 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool';
const PENDING_RUNTIME_BASELINE = 0;

describe('software-delivery migration scorecard (WU-1885)', () => {
  it('reports declared, pending-runtime, and real-handler totals', () => {
    const pendingRuntimeEntries = SOFTWARE_DELIVERY_MANIFEST.tools.filter(
      (tool) => tool.entry === PENDING_RUNTIME_TOOL_ENTRY,
    ).length;
    const declaredTools = SOFTWARE_DELIVERY_MANIFEST.tools.length;

    expect(getSoftwareDeliveryMigrationScorecard()).toEqual({
      declaredTools,
      pendingRuntimeEntries,
      realHandlerEntries: declaredTools - pendingRuntimeEntries,
    });
  });

  it('renders machine-readable scorecard output', () => {
    const output = renderSoftwareDeliveryMigrationScorecard();
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      declaredTools: expect.any(Number),
      pendingRuntimeEntries: expect.any(Number),
      realHandlerEntries: expect.any(Number),
    });
  });

  it('enforces non-increasing pending runtime migration baseline', () => {
    const { pendingRuntimeEntries } = getSoftwareDeliveryMigrationScorecard();

    expect(
      pendingRuntimeEntries,
      [
        `software-delivery pending runtime regression: ${pendingRuntimeEntries} > baseline ${PENDING_RUNTIME_BASELINE}.`,
        'If this increase is intentional and approved, update PENDING_RUNTIME_BASELINE in manifest.test.ts',
        'and document the approval in the WU notes.',
      ].join(' '),
    ).toBeLessThanOrEqual(PENDING_RUNTIME_BASELINE);
  });

  it('routes WU-1887/WU-1893/WU-1894/WU-1895 lifecycle tools to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['wu:create', 'tool-impl/wu-lifecycle-tools.ts#wuCreateTool'],
      ['wu:claim', 'tool-impl/wu-lifecycle-tools.ts#wuClaimTool'],
      ['wu:prep', 'tool-impl/wu-lifecycle-tools.ts#wuPrepTool'],
      ['wu:done', 'tool-impl/wu-lifecycle-tools.ts#wuDoneTool'],
      ['wu:status', 'tool-impl/wu-lifecycle-tools.ts#wuStatusTool'],
      ['wu:preflight', 'tool-impl/wu-lifecycle-tools.ts#wuPreflightTool'],
      ['wu:validate', 'tool-impl/wu-lifecycle-tools.ts#wuValidateTool'],
      ['wu:block', 'tool-impl/wu-lifecycle-tools.ts#wuBlockTool'],
      ['wu:unblock', 'tool-impl/wu-lifecycle-tools.ts#wuUnblockTool'],
      ['wu:release', 'tool-impl/wu-lifecycle-tools.ts#wuReleaseTool'],
      ['wu:recover', 'tool-impl/wu-lifecycle-tools.ts#wuRecoverTool'],
      ['wu:repair', 'tool-impl/wu-lifecycle-tools.ts#wuRepairTool'],
      ['wu:brief', 'tool-impl/wu-lifecycle-tools.ts#wuBriefTool'],
      ['wu:delegate', 'tool-impl/wu-lifecycle-tools.ts#wuDelegateTool'],
      ['wu:deps', 'tool-impl/wu-lifecycle-tools.ts#wuDepsTool'],
      ['wu:edit', 'tool-impl/wu-lifecycle-tools.ts#wuEditTool'],
      ['wu:proto', 'tool-impl/wu-lifecycle-tools.ts#wuProtoTool'],
      ['wu:sandbox', 'tool-impl/wu-lifecycle-tools.ts#wuSandboxTool'],
      ['wu:prune', 'tool-impl/wu-lifecycle-tools.ts#wuPruneTool'],
      ['wu:delete', 'tool-impl/wu-lifecycle-tools.ts#wuDeleteTool'],
      ['wu:cleanup', 'tool-impl/wu-lifecycle-tools.ts#wuCleanupTool'],
      ['wu:unlock-lane', 'tool-impl/wu-lifecycle-tools.ts#wuUnlockLaneTool'],
      ['gates', 'tool-impl/wu-lifecycle-tools.ts#gatesTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });

  it('routes WU-1896 memory tools to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['mem:init', 'tool-impl/memory-tools.ts#memInitTool'],
      ['mem:start', 'tool-impl/memory-tools.ts#memStartTool'],
      ['mem:ready', 'tool-impl/memory-tools.ts#memReadyTool'],
      ['mem:checkpoint', 'tool-impl/memory-tools.ts#memCheckpointTool'],
      ['mem:cleanup', 'tool-impl/memory-tools.ts#memCleanupTool'],
      ['mem:context', 'tool-impl/memory-tools.ts#memContextTool'],
      ['mem:create', 'tool-impl/memory-tools.ts#memCreateTool'],
      ['mem:delete', 'tool-impl/memory-tools.ts#memDeleteTool'],
      ['mem:export', 'tool-impl/memory-tools.ts#memExportTool'],
      ['mem:inbox', 'tool-impl/memory-tools.ts#memInboxTool'],
      ['mem:signal', 'tool-impl/memory-tools.ts#memSignalTool'],
      ['mem:summarize', 'tool-impl/memory-tools.ts#memSummarizeTool'],
      ['mem:triage', 'tool-impl/memory-tools.ts#memTriageTool'],
      ['mem:recover', 'tool-impl/memory-tools.ts#memRecoverTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });

  it('routes WU-1903 agent tools to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['agent:session', 'tool-impl/agent-tools.ts#agentSessionTool'],
      ['agent:session-end', 'tool-impl/agent-tools.ts#agentSessionEndTool'],
      ['agent:log-issue', 'tool-impl/agent-tools.ts#agentLogIssueTool'],
      ['agent:issues-query', 'tool-impl/agent-tools.ts#agentIssuesQueryTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });

  it('routes WU-1897 initiative/plan/setup/orchestration tools to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['initiative:add-wu', 'tool-impl/initiative-orchestration-tools.ts#initiativeAddWuTool'],
      [
        'initiative:bulk-assign',
        'tool-impl/initiative-orchestration-tools.ts#initiativeBulkAssignTool',
      ],
      ['initiative:create', 'tool-impl/initiative-orchestration-tools.ts#initiativeCreateTool'],
      ['initiative:edit', 'tool-impl/initiative-orchestration-tools.ts#initiativeEditTool'],
      ['initiative:list', 'tool-impl/initiative-orchestration-tools.ts#initiativeListTool'],
      ['initiative:plan', 'tool-impl/initiative-orchestration-tools.ts#initiativePlanTool'],
      [
        'initiative:remove-wu',
        'tool-impl/initiative-orchestration-tools.ts#initiativeRemoveWuTool',
      ],
      ['initiative:status', 'tool-impl/initiative-orchestration-tools.ts#initiativeStatusTool'],
      [
        'orchestrate:init-status',
        'tool-impl/initiative-orchestration-tools.ts#orchestrateInitStatusTool',
      ],
      [
        'orchestrate:initiative',
        'tool-impl/initiative-orchestration-tools.ts#orchestrateInitiativeTool',
      ],
      ['orchestrate:monitor', 'tool-impl/initiative-orchestration-tools.ts#orchestrateMonitorTool'],
      ['plan:create', 'tool-impl/initiative-orchestration-tools.ts#planCreateTool'],
      ['plan:edit', 'tool-impl/initiative-orchestration-tools.ts#planEditTool'],
      ['plan:link', 'tool-impl/initiative-orchestration-tools.ts#planLinkTool'],
      ['plan:promote', 'tool-impl/initiative-orchestration-tools.ts#planPromoteTool'],
      ['delegation:list', 'tool-impl/initiative-orchestration-tools.ts#delegationListTool'],
      ['docs:sync', 'tool-impl/initiative-orchestration-tools.ts#docsSyncTool'],
      ['init:plan', 'tool-impl/initiative-orchestration-tools.ts#initPlanTool'],
      ['lumenflow', 'tool-impl/initiative-orchestration-tools.ts#lumenflowTool'],
      ['lumenflow:doctor', 'tool-impl/initiative-orchestration-tools.ts#lumenflowDoctorTool'],
      ['lumenflow:integrate', 'tool-impl/initiative-orchestration-tools.ts#lumenflowIntegrateTool'],
      ['lumenflow:release', 'tool-impl/initiative-orchestration-tools.ts#lumenflowReleaseTool'],
      ['lumenflow:upgrade', 'tool-impl/initiative-orchestration-tools.ts#lumenflowUpgradeTool'],
      ['sync:templates', 'tool-impl/initiative-orchestration-tools.ts#syncTemplatesTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });

  it('routes WU-1890 remaining migration surfaces to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['wu:infer-lane', 'tool-impl/parity-migration-tools.ts#wuInferLaneTool'],
      ['lane:health', 'tool-impl/parity-migration-tools.ts#laneHealthTool'],
      ['lane:suggest', 'tool-impl/parity-migration-tools.ts#laneSuggestTool'],
      ['file:read', 'tool-impl/parity-migration-tools.ts#fileReadTool'],
      ['file:write', 'tool-impl/parity-migration-tools.ts#fileWriteTool'],
      ['file:edit', 'tool-impl/parity-migration-tools.ts#fileEditTool'],
      ['file:delete', 'tool-impl/parity-migration-tools.ts#fileDeleteTool'],
      ['git:branch', 'tool-impl/parity-migration-tools.ts#gitBranchTool'],
      ['git:diff', 'tool-impl/parity-migration-tools.ts#gitDiffTool'],
      ['git:log', 'tool-impl/parity-migration-tools.ts#gitLogTool'],
      ['state:bootstrap', 'tool-impl/parity-migration-tools.ts#stateBootstrapTool'],
      ['state:cleanup', 'tool-impl/parity-migration-tools.ts#stateCleanupTool'],
      ['state:doctor', 'tool-impl/parity-migration-tools.ts#stateDoctorTool'],
      ['backlog:prune', 'tool-impl/parity-migration-tools.ts#backlogPruneTool'],
      ['config:get', 'tool-impl/parity-migration-tools.ts#configGetTool'],
      ['config:set', 'tool-impl/parity-migration-tools.ts#configSetTool'],
      ['signal:cleanup', 'tool-impl/parity-migration-tools.ts#signalCleanupTool'],
      ['validate', 'tool-impl/parity-migration-tools.ts#validateTool'],
      ['lumenflow:metrics', 'tool-impl/parity-migration-tools.ts#lumenflowMetricsTool'],
      ['lumenflow:validate', 'tool-impl/parity-migration-tools.ts#lumenflowValidateTool'],
      ['validate:agent-skills', 'tool-impl/parity-migration-tools.ts#validateAgentSkillsTool'],
      ['validate:agent-sync', 'tool-impl/parity-migration-tools.ts#validateAgentSyncTool'],
      ['validate:backlog-sync', 'tool-impl/parity-migration-tools.ts#validateBacklogSyncTool'],
      ['validate:skills-spec', 'tool-impl/parity-migration-tools.ts#validateSkillsSpecTool'],
      ['flow:bottlenecks', 'tool-impl/flow-metrics-tools.ts#flowBottlenecksTool'],
      ['flow:report', 'tool-impl/flow-metrics-tools.ts#flowReportTool'],
      ['metrics', 'tool-impl/flow-metrics-tools.ts#metricsTool'],
      ['metrics:snapshot', 'tool-impl/flow-metrics-tools.ts#metricsSnapshotTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });
});
