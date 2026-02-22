// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_DELIVERY_MANIFEST,
  getSoftwareDeliveryMigrationScorecard,
  renderSoftwareDeliveryMigrationScorecard,
} from '../manifest.js';

describe('software-delivery migration scorecard (WU-1885)', () => {
  it('reports declared, zero-pending, and real-handler totals', () => {
    const declaredTools = SOFTWARE_DELIVERY_MANIFEST.tools.length;

    expect(getSoftwareDeliveryMigrationScorecard()).toEqual({
      declaredTools,
      pendingRuntimeEntries: 0,
      realHandlerEntries: declaredTools,
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

  it('contains no pending runtime entries in the software-delivery manifest', () => {
    const { pendingRuntimeEntries } = getSoftwareDeliveryMigrationScorecard();

    expect(pendingRuntimeEntries).toBe(0);
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
      ['cloud:connect', 'tool-impl/initiative-orchestration-tools.ts#cloudConnectTool'],
      ['delegation:list', 'tool-impl/initiative-orchestration-tools.ts#delegationListTool'],
      ['docs:sync', 'tool-impl/initiative-orchestration-tools.ts#docsSyncTool'],
      ['init:plan', 'tool-impl/initiative-orchestration-tools.ts#initPlanTool'],
      ['lumenflow', 'tool-impl/initiative-orchestration-tools.ts#lumenflowTool'],
      ['lumenflow:doctor', 'tool-impl/initiative-orchestration-tools.ts#lumenflowDoctorTool'],
      ['lumenflow:integrate', 'tool-impl/initiative-orchestration-tools.ts#lumenflowIntegrateTool'],
      ['lumenflow:release', 'tool-impl/initiative-orchestration-tools.ts#lumenflowReleaseTool'],
      ['lumenflow:upgrade', 'tool-impl/initiative-orchestration-tools.ts#lumenflowUpgradeTool'],
      ['workspace:init', 'tool-impl/initiative-orchestration-tools.ts#workspaceInitTool'],
      ['sync:templates', 'tool-impl/initiative-orchestration-tools.ts#syncTemplatesTool'],
    ]);

    for (const [toolName, expectedEntry] of expectedEntries.entries()) {
      const manifestTool = SOFTWARE_DELIVERY_MANIFEST.tools.find((tool) => tool.name === toolName);
      expect(manifestTool?.entry).toBe(expectedEntry);
    }
  });

  it('routes WU-1890 remaining migration surfaces to runtime handlers', () => {
    const expectedEntries = new Map<string, string>([
      ['wu:infer-lane', 'tool-impl/runtime-native-tools.ts#wuInferLaneTool'],
      ['lane:health', 'tool-impl/runtime-native-tools.ts#laneHealthTool'],
      ['lane:suggest', 'tool-impl/runtime-native-tools.ts#laneSuggestTool'],
      ['file:read', 'tool-impl/runtime-native-tools.ts#fileReadTool'],
      ['file:write', 'tool-impl/runtime-native-tools.ts#fileWriteTool'],
      ['file:edit', 'tool-impl/runtime-native-tools.ts#fileEditTool'],
      ['file:delete', 'tool-impl/runtime-native-tools.ts#fileDeleteTool'],
      ['git:branch', 'tool-impl/runtime-native-tools.ts#gitBranchTool'],
      ['git:diff', 'tool-impl/runtime-native-tools.ts#gitDiffTool'],
      ['git:log', 'tool-impl/runtime-native-tools.ts#gitLogTool'],
      ['state:bootstrap', 'tool-impl/runtime-native-tools.ts#stateBootstrapTool'],
      ['state:cleanup', 'tool-impl/runtime-native-tools.ts#stateCleanupTool'],
      ['state:doctor', 'tool-impl/runtime-native-tools.ts#stateDoctorTool'],
      ['backlog:prune', 'tool-impl/runtime-native-tools.ts#backlogPruneTool'],
      ['config:get', 'tool-impl/runtime-native-tools.ts#configGetTool'],
      ['config:set', 'tool-impl/runtime-native-tools.ts#configSetTool'],
      ['signal:cleanup', 'tool-impl/runtime-native-tools.ts#signalCleanupTool'],
      ['validate', 'tool-impl/runtime-native-tools.ts#validateTool'],
      ['lumenflow:metrics', 'tool-impl/runtime-native-tools.ts#lumenflowMetricsTool'],
      ['lumenflow:validate', 'tool-impl/runtime-native-tools.ts#lumenflowValidateTool'],
      ['validate:agent-skills', 'tool-impl/runtime-native-tools.ts#validateAgentSkillsTool'],
      ['validate:agent-sync', 'tool-impl/runtime-native-tools.ts#validateAgentSyncTool'],
      ['validate:backlog-sync', 'tool-impl/runtime-native-tools.ts#validateBacklogSyncTool'],
      ['validate:skills-spec', 'tool-impl/runtime-native-tools.ts#validateSkillsSpecTool'],
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
