// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGPL_RUNTIME_DEPENDENCIES,
  assertOssCompleteConstraints,
  containsTopLevelControlPlaneConfig,
  findForbiddenAgplRuntimeDependencies,
  validateLocalOnlyWorkspaceYaml,
} from '../../../../scripts/oss-complete-gate.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(TEST_DIR, '..');
const SDK_PACKAGE_JSON_PATH = path.join(SDK_ROOT, 'package.json');

describe('oss-complete gate (WU-2154)', () => {
  it('detects top-level control_plane in local-only workspace YAML', () => {
    const yaml = [
      'id: lumenflow-dev',
      'name: LumenFlow',
      'control_plane:',
      '  endpoint: https://control.example',
      '  org_id: org-1',
      '',
    ].join('\n');

    expect(containsTopLevelControlPlaneConfig(yaml)).toBe(true);
    expect(() => validateLocalOnlyWorkspaceYaml(yaml)).toThrow(
      /local-only workspace must not define control_plane/i,
    );
  });

  it('accepts clean local-only workspace YAML with no top-level control_plane', () => {
    const yaml = [
      'id: lumenflow-dev',
      'name: LumenFlow',
      'software_delivery:',
      '  version: "2.0"',
      '  notes:',
      '    nested_control_plane: allowed-as-text',
      '',
    ].join('\n');

    expect(containsTopLevelControlPlaneConfig(yaml)).toBe(false);
    expect(() => validateLocalOnlyWorkspaceYaml(yaml)).not.toThrow();
  });

  it('flags AGPL runtime dependencies in package.json dependencies', () => {
    const forbidden = findForbiddenAgplRuntimeDependencies({
      dependencies: {
        '@lumenflow/kernel': '^3.8.7',
        chalk: '^5.3.0',
      },
    });

    expect(forbidden).toEqual(['@lumenflow/kernel']);
    expect(AGPL_RUNTIME_DEPENDENCIES.has('@lumenflow/kernel')).toBe(true);
  });

  it('passes on clean workspace and clean packed dependency set', () => {
    expect(() =>
      assertOssCompleteConstraints({
        workspaceYamlContent: 'id: lumenflow-dev\nname: LumenFlow\n',
        packedPackageJson: {
          name: '@lumenflow/control-plane-sdk',
          dependencies: {
            chalk: '^5.3.0',
          },
        },
      }),
    ).not.toThrow();
  });

  it('aggregates failures for control_plane presence and AGPL dependency', () => {
    expect(() =>
      assertOssCompleteConstraints({
        workspaceYamlContent: 'id: lumenflow-dev\ncontrol_plane:\n  endpoint: https://cp\n',
        packedPackageJson: {
          name: '@lumenflow/control-plane-sdk',
          dependencies: {
            '@lumenflow/kernel': '^3.8.7',
          },
        },
      }),
    ).toThrow(/control_plane/i);
  });

  it('wires SDK test script to run OSS gate without bypass operators', () => {
    const packageJson = JSON.parse(readFileSync(SDK_PACKAGE_JSON_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    const testScript = packageJson.scripts?.test ?? '';
    expect(testScript).toContain('oss-complete-gate.mjs');
    expect(testScript).not.toContain('|| true');
    expect(testScript).not.toContain('&& true');
  });
});
