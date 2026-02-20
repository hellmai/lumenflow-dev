// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-config-lanes.test.ts
 * WU-1748: init no longer finalizes lane definitions.
 *
 * Lane design is now a dedicated lifecycle process owned by lane commands:
 *   unconfigured -> draft -> locked
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { scaffoldProject } from '../init.js';

/** Config file name - extracted to avoid duplicate string lint errors */
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

describe('init config lane lifecycle bootstrap (WU-1748)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-config-lanes-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse config from temp directory */
  function readConfig(): Record<string, unknown> {
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);
    const configContent = fs.readFileSync(configPath, 'utf-8');
    return YAML.parse(configContent) as Record<string, unknown>;
  }

  it('should generate .lumenflow.config.yaml with lanes.lifecycle.status', async () => {
    // Arrange
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(configPath)).toBe(true);

    const config = readConfig();

    // Should have lanes.lifecycle.status (deferred lifecycle)
    expect(config.lanes).toBeDefined();
    const lanes = config.lanes as Record<string, unknown>;
    const lifecycle = lanes.lifecycle as Record<string, unknown> | undefined;
    expect(lifecycle).toBeDefined();
    expect(lifecycle?.status).toBe('unconfigured');
  });

  it('should NOT include finalized lanes.definitions during init', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();
    const lanes = config.lanes as Record<string, unknown>;
    expect(lanes.definitions).toBeUndefined();
  });
});

/** WU template file name - extracted to avoid duplicate string lint errors */
const WU_TEMPLATE_FILE_NAME = 'wu-template.yaml';

describe('init WU template lane neutrality (WU-1499)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-wu-template-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read the generated WU template YAML as raw text */
  function readWuTemplate(): string {
    // The template is scaffolded under the docs tasks path templates dir.
    // With arc42 (default), that is docs/04-operations/tasks/templates/wu-template.yaml
    const templatePath = path.join(
      tempDir,
      'docs',
      '04-operations',
      'tasks',
      'templates',
      WU_TEMPLATE_FILE_NAME,
    );
    if (!fs.existsSync(templatePath)) {
      // Try simple docs structure fallback
      const simplePath = path.join(tempDir, 'docs', 'tasks', 'templates', WU_TEMPLATE_FILE_NAME);
      return fs.readFileSync(simplePath, 'utf-8');
    }
    return fs.readFileSync(templatePath, 'utf-8');
  }

  /** Helper to parse the generated WU template YAML */
  function parseWuTemplate(): Record<string, unknown> {
    return YAML.parse(readWuTemplate()) as Record<string, unknown>;
  }

  it('should NOT hardcode "Framework: CLI" as the default lane value', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const template = parseWuTemplate();
    expect(template.lane).not.toBe('Framework: CLI');
  });

  it('should use a neutral placeholder lane value that requires explicit selection', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const template = parseWuTemplate();
    const laneValue = template.lane as string;

    // The placeholder should indicate it needs to be replaced (angle brackets or similar)
    // It should NOT be UnsafeAny specific real lane
    expect(laneValue).toContain('<');
    expect(laneValue).toContain('>');
    // Should demonstrate the Parent: Sublane format
    expect(laneValue).toContain(':');
  });

  it('should include the lane format pattern in the raw template', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const rawTemplate = readWuTemplate();

    // The raw template should contain the lane field with a placeholder
    expect(rawTemplate).toContain("lane: '<Parent: Sublane>'");
    // Should NOT contain the biased default
    expect(rawTemplate).not.toContain("lane: 'Framework: CLI'");
  });
});
