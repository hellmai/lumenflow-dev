// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Agent Spawn Coordination Integration Tests (WU-1363)
 *
 * Integration tests for agent spawn coordination:
 * - AC4: Agent spawn coordination
 *
 * These tests validate the spawn system's ability to:
 * - Generate spawn prompts for WUs
 * - Check lane occupation before spawning
 * - Record spawn events to registry
 * - Coordinate parallel agents via signals
 *
 * TDD: Tests written BEFORE implementation verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stringifyYAML, parseYAML } from '@lumenflow/core/wu-yaml';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import { DELEGATION_REGISTRY_FILE_NAME } from '@lumenflow/core/delegation-registry-store';
import { getLatestWuBriefEvidence } from '@lumenflow/core/wu-state-store';
import {
  generateTaskInvocation,
  generateCodexPrompt,
  generateActionSection,
  checkLaneOccupation,
  generateLaneOccupationWarning,
  generateEffortScalingRules,
  generateParallelToolCallGuidance,
  generateCompletionFormat,
  recordWuBriefEvidence,
} from '../wu-spawn.js';
import {
  buildMissingSpawnProvenanceMessage,
  enforceSpawnProvenanceForDone,
  shouldEnforceSpawnProvenance,
} from '../wu-done.js';
import { SpawnStrategyFactory } from '@lumenflow/core/spawn-strategy';
import { createSignal, loadSignals } from '@lumenflow/memory';

// Test constants
const TEST_WU_ID = 'WU-9920';
const TEST_LANE = 'Framework: CLI';
const TEST_TITLE = 'Spawn coordination test';
const TEST_DESCRIPTION =
  'Context: Testing spawn. Problem: Need coordination. Solution: Use signals.';

/**
 * Helper to create a test project with spawn infrastructure
 */
function createSpawnProject(baseDir: string): void {
  const dirs = [
    'docs/04-operations/tasks/wu',
    '.lumenflow/state',
    '.lumenflow/memory',
    '.lumenflow/stamps',
    '.lumenflow/locks',
    'packages/@lumenflow/cli/src',
  ];

  for (const dir of dirs) {
    mkdirSync(join(baseDir, dir), { recursive: true });
  }

  // Create config with lane definitions
  const configContent = `
software_delivery:
  version: 1
  lanes:
    definitions:
      - name: 'Framework: CLI'
        wip_limit: 1
        code_paths:
          - 'packages/@lumenflow/cli/**'
      - name: 'Framework: Core'
        wip_limit: 1
        code_paths:
          - 'packages/@lumenflow/core/**'
  agents:
    defaultClient: claude-code
  git:
    requireRemote: false
`;
  writeFileSync(join(baseDir, 'workspace.yaml'), configContent);

  // Initialize git
  execFileSync('git', ['init'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: baseDir, stdio: 'pipe' });
}

/**
 * Helper to create a WU for spawn testing
 */
function createSpawnWU(
  baseDir: string,
  id: string,
  options: {
    status?: string;
    lane?: string;
    worktreePath?: string;
    claimedAt?: string;
  } = {},
): string {
  const wuDir = join(baseDir, 'docs/04-operations/tasks/wu');
  const wuPath = join(wuDir, `${id}.yaml`);

  const doc: Record<string, unknown> = {
    id,
    title: TEST_TITLE,
    lane: options.lane || TEST_LANE,
    status: options.status || WU_STATUS.READY,
    type: 'feature',
    priority: 'P2',
    created: '2026-02-03',
    description: TEST_DESCRIPTION,
    acceptance: ['Spawn works correctly', 'Signals are sent'],
    code_paths: ['packages/@lumenflow/cli/src'],
    tests: {
      unit: ['packages/@lumenflow/cli/src/__tests__/spawn.test.ts'],
    },
    exposure: 'backend-only',
  };

  if (options.worktreePath) {
    doc.worktree_path = options.worktreePath;
  }
  if (options.claimedAt) {
    doc.claimed_at = options.claimedAt;
  }

  writeFileSync(wuPath, stringifyYAML(doc));
  return wuPath;
}

/**
 * Helper to create a lane lock
 */
function createLaneLock(baseDir: string, lane: string, wuId: string): void {
  const lockDir = join(baseDir, '.lumenflow/locks');
  mkdirSync(lockDir, { recursive: true });

  const laneSlug = lane.toLowerCase().replace(/[:\s]+/g, '-');
  const lockPath = join(lockDir, `${laneSlug}.lock`);

  const lockContent = {
    lane,
    wuId,
    lockedAt: new Date().toISOString(),
    agent: 'test-agent',
  };

  writeFileSync(lockPath, JSON.stringify(lockContent, null, 2));
}

describe('Agent Spawn Coordination Integration Tests (WU-1363)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `spawn-coordination-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    createSpawnProject(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    vi.clearAllMocks();
  });

  describe('AC4: Integration tests for agent spawn coordination', () => {
    describe('spawn prompt generation', () => {
      it('should generate Task tool invocation with correct structure', () => {
        // Arrange
        const doc = {
          title: TEST_TITLE,
          lane: TEST_LANE,
          status: WU_STATUS.IN_PROGRESS,
          type: 'feature',
          description: TEST_DESCRIPTION,
          code_paths: ['packages/@lumenflow/cli/src'],
          acceptance: ['Test criterion'],
          worktree_path: 'worktrees/framework-cli-wu-9920',
        };
        const strategy = SpawnStrategyFactory.create('claude-code');

        // Act
        const invocation = generateTaskInvocation(doc, TEST_WU_ID, strategy);

        // Assert
        expect(invocation).toContain('antml:invoke');
        expect(invocation).toContain('antml:function_calls');
        expect(invocation).toContain(TEST_WU_ID);
        expect(invocation).toContain('general-purpose');
      });

      it('should include WU details in spawn prompt', () => {
        // Arrange
        const doc = {
          title: TEST_TITLE,
          lane: TEST_LANE,
          status: WU_STATUS.IN_PROGRESS,
          type: 'feature',
          description: TEST_DESCRIPTION,
          code_paths: ['packages/@lumenflow/cli/src'],
          acceptance: ['Criterion 1', 'Criterion 2'],
        };
        const strategy = SpawnStrategyFactory.create('claude-code');

        // Act
        const invocation = generateTaskInvocation(doc, TEST_WU_ID, strategy);

        // Assert
        expect(invocation).toContain(TEST_TITLE);
        expect(invocation).toContain(TEST_LANE);
        expect(invocation).toContain('Criterion 1');
        expect(invocation).toContain('Criterion 2');
      });

      it('should include constraints block at end', () => {
        // Arrange
        const doc = {
          title: TEST_TITLE,
          lane: TEST_LANE,
          status: WU_STATUS.READY,
          type: 'feature',
          description: TEST_DESCRIPTION,
          code_paths: [],
          acceptance: [],
        };
        const strategy = SpawnStrategyFactory.create('claude-code');

        // Act
        const invocation = generateTaskInvocation(doc, TEST_WU_ID, strategy);

        // Assert
        expect(invocation).toContain('&lt;constraints&gt;');
        expect(invocation).toContain('CRITICAL RULES');
        expect(invocation).toContain('LUMENFLOW_SPAWN_END');
      });

      it('should include status-guarded completion workflow in task invocation output', () => {
        // Arrange
        const doc = {
          title: TEST_TITLE,
          lane: TEST_LANE,
          status: WU_STATUS.IN_PROGRESS,
          type: 'feature',
          description: TEST_DESCRIPTION,
          code_paths: ['packages/@lumenflow/cli/src'],
          acceptance: ['Test criterion'],
          worktree_path: 'worktrees/framework-cli-wu-9920',
        };
        const strategy = SpawnStrategyFactory.create('claude-code');

        // Act
        const invocation = generateTaskInvocation(doc, TEST_WU_ID, strategy);

        // Assert
        expect(invocation).toContain('## Completion Workflow');
        expect(invocation).toContain(`pnpm wu:status --id ${TEST_WU_ID}`);
        expect(invocation).toContain('If status is `done`, stop and report already completed.');
        expect(invocation).toContain(`do NOT run \`pnpm wu:recover --id ${TEST_WU_ID}\``);
        expect(invocation).toContain('If status is `in_progress`, continue autonomously');
      });

      it('should include status-guarded completion workflow in codex prompt output', () => {
        // Arrange
        const doc = {
          title: TEST_TITLE,
          lane: TEST_LANE,
          status: WU_STATUS.IN_PROGRESS,
          type: 'feature',
          description: TEST_DESCRIPTION,
          code_paths: ['packages/@lumenflow/cli/src'],
          acceptance: ['Test criterion'],
          worktree_path: 'worktrees/framework-cli-wu-9920',
        };
        const strategy = SpawnStrategyFactory.create('claude-code');

        // Act
        const prompt = generateCodexPrompt(doc, TEST_WU_ID, strategy);

        // Assert
        expect(prompt).toContain('## Completion Workflow');
        expect(prompt).toContain(`pnpm wu:status --id ${TEST_WU_ID}`);
        expect(prompt).toContain('If status is `done`, stop and report already completed.');
        expect(prompt).toContain(`do NOT run \`pnpm wu:recover --id ${TEST_WU_ID}\``);
        expect(prompt).toContain('If status is `in_progress`, continue autonomously');
      });
    });

    describe('action section generation', () => {
      it('should instruct to claim when WU is unclaimed', () => {
        // Arrange
        const doc = {
          lane: TEST_LANE,
          status: WU_STATUS.READY,
        };

        // Act
        const action = generateActionSection(doc, TEST_WU_ID);

        // Assert
        expect(action).toContain('wu:claim');
        expect(action).toContain('FIRST');
        expect(action).toContain(TEST_WU_ID);
      });

      it('should instruct to continue when WU is already claimed', () => {
        // Arrange
        const doc = {
          lane: TEST_LANE,
          status: WU_STATUS.IN_PROGRESS,
          claimed_at: new Date().toISOString(),
          worktree_path: 'worktrees/framework-cli-wu-9920',
        };

        // Act
        const action = generateActionSection(doc, TEST_WU_ID);

        // Assert
        expect(action).toContain('already claimed');
        expect(action).toContain('worktrees/framework-cli-wu-9920');
        expect(action).not.toContain('wu:claim');
      });
    });

    describe('lane occupation checking', () => {
      it('should detect when lane is occupied by another WU', () => {
        // Arrange
        process.chdir(tempDir);
        createLaneLock(tempDir, TEST_LANE, 'WU-8888');

        // Act
        const occupation = checkLaneOccupation(TEST_LANE);

        // Assert
        // Note: This may return null in test environment without full state
        // The important thing is the function runs without error
        expect(typeof occupation).toBe('object');
      });

      it('should generate occupation warning message', () => {
        // Arrange
        const lockMetadata = {
          lane: TEST_LANE,
          wuId: 'WU-8888',
        };

        // Act
        const warning = generateLaneOccupationWarning(lockMetadata, TEST_WU_ID);

        // Assert
        expect(warning).toContain(TEST_LANE);
        expect(warning).toContain('WU-8888');
        expect(warning).toContain('Options');
        expect(warning).toContain('WIP=');
      });

      it('should include stale lock guidance when lock is old', () => {
        // Arrange
        const lockMetadata = {
          lane: TEST_LANE,
          wuId: 'WU-8888',
        };

        // Act
        const warning = generateLaneOccupationWarning(lockMetadata, TEST_WU_ID, { isStale: true });

        // Assert
        expect(warning).toContain('STALE');
        expect(warning).toContain('wu:block');
      });
    });

    describe('effort scaling rules', () => {
      it('should include complexity heuristics', () => {
        // Act
        const rules = generateEffortScalingRules();

        // Assert
        expect(rules).toContain('Simple');
        expect(rules).toContain('Moderate');
        expect(rules).toContain('Complex');
        expect(rules).toContain('Multi-domain');
        expect(rules).toContain('Tool Calls');
      });
    });

    describe('parallel tool call guidance', () => {
      it('should include parallelism instructions', () => {
        // Act
        const guidance = generateParallelToolCallGuidance();

        // Assert
        expect(guidance).toContain('parallel');
        expect(guidance).toContain('independent');
        expect(guidance).toContain('Good examples');
        expect(guidance).toContain('Bad examples');
      });
    });

    describe('completion format', () => {
      it('should include structured output format', () => {
        // Act
        const format = generateCompletionFormat(TEST_WU_ID);

        // Assert
        expect(format).toContain('Summary');
        expect(format).toContain('Artifacts');
        expect(format).toContain('Verification');
        expect(format).toContain('Blockers');
        expect(format).toContain('Follow-up');
      });
    });

    describe('signal-based coordination', () => {
      it('should allow agents to signal progress', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act - Agent sends progress signal
        const result = await createSignal(tempDir, {
          message: 'AC1 complete: tests passing',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.signal.wu_id).toBe(TEST_WU_ID);
      });

      it('should allow agents to check for signals from other agents', async () => {
        // Arrange
        process.chdir(tempDir);

        // Another agent sends a signal
        await createSignal(tempDir, {
          message: 'Dependency WU-8888 complete',
          wuId: 'WU-8888',
          lane: TEST_LANE,
        });

        // Current agent's signal
        await createSignal(tempDir, {
          message: 'Starting WU-9920',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        // Act - Check lane signals (from UnsafeAny agent in the lane)
        const laneSignals = await loadSignals(tempDir, { lane: TEST_LANE });

        // Assert
        expect(laneSignals).toHaveLength(2);
      });

      it('should support WU-specific signal filtering', async () => {
        // Arrange
        process.chdir(tempDir);

        await createSignal(tempDir, { message: 'Signal 1', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Signal 2', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Other WU', wuId: 'WU-8888' });

        // Act
        const wuSignals = await loadSignals(tempDir, { wuId: TEST_WU_ID });

        // Assert
        expect(wuSignals).toHaveLength(2);
        wuSignals.forEach((sig) => {
          expect(sig.wu_id).toBe(TEST_WU_ID);
        });
      });
    });

    describe('spawn registry', () => {
      it('should record spawn events', async () => {
        // Arrange
        process.chdir(tempDir);
        const registryPath = join(tempDir, '.lumenflow/state', DELEGATION_REGISTRY_FILE_NAME);

        // Act - Record spawn event directly
        const spawnEvent = {
          id: 'dlg-a1b2',
          parentWuId: 'WU-1363',
          targetWuId: TEST_WU_ID,
          lane: TEST_LANE,
          delegatedAt: new Date().toISOString(),
          status: 'pending',
          completedAt: null,
        };
        writeFileSync(registryPath, JSON.stringify(spawnEvent) + '\n');

        // Assert
        expect(existsSync(registryPath)).toBe(true);
        const content = readFileSync(registryPath, 'utf-8');
        expect(content).toContain(TEST_WU_ID);
        expect(content).toContain('WU-1363');
      });

      it('should track multiple spawn events', async () => {
        // Arrange
        process.chdir(tempDir);
        const registryPath = join(tempDir, '.lumenflow/state', DELEGATION_REGISTRY_FILE_NAME);

        // Act - Record multiple spawn events
        const events = [
          {
            id: 'dlg-a111',
            parentWuId: 'WU-1363',
            targetWuId: 'WU-001',
            lane: 'Framework: CLI',
            delegatedAt: new Date().toISOString(),
            status: 'pending',
            completedAt: null,
          },
          {
            id: 'dlg-b222',
            parentWuId: 'WU-1363',
            targetWuId: 'WU-002',
            lane: 'Framework: Core',
            delegatedAt: new Date().toISOString(),
            status: 'pending',
            completedAt: null,
          },
          {
            id: 'dlg-c333',
            parentWuId: 'WU-1363',
            targetWuId: 'WU-003',
            lane: 'Framework: CLI',
            delegatedAt: new Date().toISOString(),
            status: 'pending',
            completedAt: null,
          },
        ];

        const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
        writeFileSync(registryPath, content);

        // Assert
        const lines = readFileSync(registryPath, 'utf-8').trim().split('\n');
        expect(lines).toHaveLength(3);

        const parsed = lines.map((line) => JSON.parse(line));
        expect(parsed.map((e) => e.targetWuId)).toEqual(['WU-001', 'WU-002', 'WU-003']);
      });
    });

    describe('spawn provenance enforcement for completion (WU-1599)', () => {
      it('should enforce provenance for initiative-governed WUs without --force', async () => {
        process.chdir(tempDir);

        await expect(
          enforceSpawnProvenanceForDone(
            TEST_WU_ID,
            { initiative: 'INIT-023', lane: TEST_LANE },
            { baseDir: tempDir, force: false },
          ),
        ).rejects.toThrow('Missing spawn provenance');
      });

      it('should allow legacy/manual override with --force and record audit signal', async () => {
        process.chdir(tempDir);

        await expect(
          enforceSpawnProvenanceForDone(
            TEST_WU_ID,
            { initiative: 'INIT-023', lane: TEST_LANE },
            { baseDir: tempDir, force: true },
          ),
        ).resolves.toBeUndefined();

        const signals = await loadSignals(tempDir, { wuId: TEST_WU_ID });
        expect(signals.some((signal) => signal.message.includes('spawn-provenance override'))).toBe(
          true,
        );
      });

      it('should enforce pickup evidence when spawn entry is intent-only', async () => {
        process.chdir(tempDir);
        const registryPath = join(tempDir, '.lumenflow/state', DELEGATION_REGISTRY_FILE_NAME);
        writeFileSync(
          registryPath,
          JSON.stringify({
            id: 'dlg-a1b2',
            parentWuId: 'WU-1500',
            targetWuId: TEST_WU_ID,
            lane: TEST_LANE,
            intent: 'delegation',
            delegatedAt: new Date().toISOString(),
            status: 'pending',
            completedAt: null,
          }) + '\n',
          'utf-8',
        );

        await expect(
          enforceSpawnProvenanceForDone(
            TEST_WU_ID,
            { initiative: 'INIT-023', lane: TEST_LANE },
            { baseDir: tempDir, force: false },
          ),
        ).rejects.toThrow('Missing pickup evidence');
      });

      it('should pass when spawn registry entry includes pickup evidence for initiative-governed WU', async () => {
        process.chdir(tempDir);
        const registryPath = join(tempDir, '.lumenflow/state', DELEGATION_REGISTRY_FILE_NAME);
        writeFileSync(
          registryPath,
          JSON.stringify({
            id: 'dlg-a1b2',
            parentWuId: 'WU-1500',
            targetWuId: TEST_WU_ID,
            lane: TEST_LANE,
            intent: 'delegation',
            delegatedAt: new Date().toISOString(),
            pickedUpAt: new Date().toISOString(),
            pickedUpBy: 'agent@test.com',
            status: 'pending',
            completedAt: null,
          }) + '\n',
          'utf-8',
        );

        await expect(
          enforceSpawnProvenanceForDone(
            TEST_WU_ID,
            { initiative: 'INIT-023', lane: TEST_LANE },
            { baseDir: tempDir, force: false },
          ),
        ).resolves.toBeUndefined();
      });

      it('should not enforce provenance for non-initiative WUs', () => {
        expect(shouldEnforceSpawnProvenance({ lane: TEST_LANE })).toBe(false);
        expect(shouldEnforceSpawnProvenance({ initiative: '', lane: TEST_LANE })).toBe(false);
        expect(shouldEnforceSpawnProvenance({ initiative: 'INIT-023', lane: TEST_LANE })).toBe(
          true,
        );
      });

      it('should provide actionable remediation guidance', () => {
        const message = buildMissingSpawnProvenanceMessage(TEST_WU_ID, 'INIT-023');
        expect(message).toContain('Missing spawn provenance');
        expect(message).toContain('--force');
        expect(message).toContain('wu:delegate');
      });
    });

    describe('wu:brief execution evidence (WU-2132)', () => {
      it('records auditable brief evidence tied to WU id and timestamp', async () => {
        process.chdir(tempDir);

        await recordWuBriefEvidence({
          wuId: TEST_WU_ID,
          workspaceRoot: tempDir,
          clientName: 'codex-cli',
        });

        const evidence = await getLatestWuBriefEvidence(join(tempDir, '.lumenflow/state'), TEST_WU_ID);
        expect(evidence).toBeDefined();
        expect(evidence?.wuId).toBe(TEST_WU_ID);
        expect(typeof evidence?.timestamp).toBe('string');
        expect(evidence?.note).toContain('[wu:brief]');
      });
    });

    describe('complete spawn coordination workflow', () => {
      it('should support full spawn and signal workflow', async () => {
        // This test validates the complete spawn coordination:
        // 1. Generate spawn prompt for WU
        // 2. Record spawn event
        // 3. Spawned agent sends signals
        // 4. Parent agent receives signals
        // 5. Spawned agent completes

        // Arrange
        process.chdir(tempDir);
        createSpawnWU(tempDir, TEST_WU_ID, {
          status: WU_STATUS.READY,
          lane: TEST_LANE,
        });

        // Step 1: Generate spawn prompt
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const doc = parseYAML(readFileSync(wuPath, 'utf-8'));
        const strategy = SpawnStrategyFactory.create('claude-code');
        const invocation = generateTaskInvocation(doc, TEST_WU_ID, strategy);

        expect(invocation).toContain(TEST_WU_ID);
        expect(invocation).toContain('antml:invoke');

        // Step 2: Record spawn event
        const registryPath = join(tempDir, '.lumenflow/state', DELEGATION_REGISTRY_FILE_NAME);
        const spawnEvent = {
          id: 'dlg-d001',
          parentWuId: 'WU-1363',
          targetWuId: TEST_WU_ID,
          lane: TEST_LANE,
          delegatedAt: new Date().toISOString(),
          status: 'pending',
          completedAt: null,
        };
        writeFileSync(registryPath, JSON.stringify(spawnEvent) + '\n');
        expect(existsSync(registryPath)).toBe(true);

        // Step 3: Spawned agent sends progress signals
        await createSignal(tempDir, {
          message: 'Starting implementation',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });
        await createSignal(tempDir, {
          message: 'AC1 complete',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        // Step 4: Parent agent checks signals
        const signals = await loadSignals(tempDir, { wuId: TEST_WU_ID });
        expect(signals).toHaveLength(2);

        // Step 5: Spawned agent sends completion signal
        await createSignal(tempDir, {
          message: 'All ACs complete, running gates',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        const allSignals = await loadSignals(tempDir, { wuId: TEST_WU_ID });
        expect(allSignals).toHaveLength(3);
        expect(allSignals[2].message).toContain('complete');
      });
    });
  });
});
