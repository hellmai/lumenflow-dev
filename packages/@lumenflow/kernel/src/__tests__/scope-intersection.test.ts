// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type { ToolScope } from '../kernel.schemas.js';
import { intersectToolScopes } from '../tool-host/index.js';

describe('scope intersection', () => {
  it('intersects broader and narrower path scopes to the narrowest allowed scope', () => {
    const workspaceAllowed: ToolScope[] = [
      { type: 'path', pattern: 'packages/**', access: 'read' },
    ];
    const laneAllowed: ToolScope[] = [
      { type: 'path', pattern: 'packages/@lumenflow/**', access: 'read' },
    ];
    const taskDeclared: ToolScope[] = [
      { type: 'path', pattern: 'packages/@lumenflow/kernel/src/tool-host/**', access: 'read' },
    ];
    const toolRequired: ToolScope[] = [
      { type: 'path', pattern: 'packages/@lumenflow/kernel/src/**', access: 'read' },
    ];

    const intersection = intersectToolScopes({
      workspaceAllowed,
      laneAllowed,
      taskDeclared,
      toolRequired,
    });

    expect(intersection).toContainEqual({
      type: 'path',
      pattern: 'packages/@lumenflow/kernel/src/tool-host/**',
      access: 'read',
    });
  });

  it('intersects read and write scopes independently', () => {
    const workspaceAllowed: ToolScope[] = [
      { type: 'path', pattern: 'docs/**', access: 'read' },
      { type: 'path', pattern: 'packages/**', access: 'write' },
    ];
    const laneAllowed: ToolScope[] = [
      { type: 'path', pattern: 'docs/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'write' },
    ];
    const taskDeclared: ToolScope[] = [
      { type: 'path', pattern: 'docs/tasks/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/src/**', access: 'write' },
    ];
    const toolRequired: ToolScope[] = [
      { type: 'path', pattern: 'docs/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/src/tool-host/**', access: 'write' },
    ];

    const intersection = intersectToolScopes({
      workspaceAllowed,
      laneAllowed,
      taskDeclared,
      toolRequired,
    });

    expect(intersection).toContainEqual({
      type: 'path',
      pattern: 'docs/tasks/**',
      access: 'read',
    });
    expect(intersection).toContainEqual({
      type: 'path',
      pattern: 'packages/@lumenflow/kernel/src/tool-host/**',
      access: 'write',
    });
  });

  it('intersects network posture independently from path scopes', () => {
    const workspaceAllowed: ToolScope[] = [
      { type: 'path', pattern: 'packages/**', access: 'read' },
      { type: 'network', posture: 'full' },
    ];
    const laneAllowed: ToolScope[] = [{ type: 'network', posture: 'full' }];
    const taskDeclared: ToolScope[] = [{ type: 'network', posture: 'off' }];
    const toolRequired: ToolScope[] = [{ type: 'network', posture: 'full' }];

    const intersection = intersectToolScopes({
      workspaceAllowed,
      laneAllowed,
      taskDeclared,
      toolRequired,
    });

    const networkScopes = intersection.filter((scope) => scope.type === 'network');
    expect(networkScopes).toHaveLength(0);
    expect(intersection.filter((scope) => scope.type === 'path')).toHaveLength(0);
  });

  it('handles wildcard-vs-wildcard intersections by selecting the narrowest overlap', () => {
    const wildcardScopes: ToolScope[] = [
      { type: 'path', pattern: 'packages/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/src/**', access: 'read' },
    ];

    const intersection = intersectToolScopes({
      workspaceAllowed: [wildcardScopes[0]],
      laneAllowed: [wildcardScopes[1]],
      taskDeclared: [wildcardScopes[2]],
      toolRequired: [wildcardScopes[3]],
    });

    expect(intersection).toEqual([
      {
        type: 'path',
        access: 'read',
        pattern: 'packages/@lumenflow/kernel/src/**',
      },
    ]);
  });

  it('returns an empty intersection when any required scope set is empty', () => {
    const intersection = intersectToolScopes({
      workspaceAllowed: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
      laneAllowed: [],
      taskDeclared: [{ type: 'path', pattern: 'packages/@lumenflow/**', access: 'read' }],
      toolRequired: [{ type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'read' }],
    });

    expect(intersection).toEqual([]);
  });

  it('returns no path scopes for disjoint wildcard patterns', () => {
    const intersection = intersectToolScopes({
      workspaceAllowed: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
      laneAllowed: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
      taskDeclared: [{ type: 'path', pattern: 'docs/tasks/**', access: 'read' }],
      toolRequired: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
    });

    expect(intersection).toEqual([]);
  });

  it('skips path candidates that fail lane/task overlap or pairwise overlap checks', () => {
    const laneMismatch = intersectToolScopes({
      workspaceAllowed: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
      laneAllowed: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
      taskDeclared: [{ type: 'path', pattern: 'packages/@lumenflow/**', access: 'read' }],
      toolRequired: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
    });

    expect(laneMismatch).toEqual([]);

    const taskMismatch = intersectToolScopes({
      workspaceAllowed: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
      laneAllowed: [{ type: 'path', pattern: 'packages/@lumenflow/**', access: 'read' }],
      taskDeclared: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
      toolRequired: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
    });

    expect(taskMismatch).toEqual([]);

    const pairwiseDisjoint = intersectToolScopes({
      workspaceAllowed: [{ type: 'path', pattern: 'packages/a/**', access: 'read' }],
      laneAllowed: [{ type: 'path', pattern: 'packages/*/src/**', access: 'read' }],
      taskDeclared: [{ type: 'path', pattern: 'packages/b/src/**', access: 'read' }],
      toolRequired: [{ type: 'path', pattern: 'packages/**', access: 'read' }],
    });

    expect(pairwiseDisjoint).toEqual([]);
  });

  it('retains matching network posture when all policy layers allow it', () => {
    const intersection = intersectToolScopes({
      workspaceAllowed: [{ type: 'network', posture: 'full' }],
      laneAllowed: [{ type: 'network', posture: 'full' }],
      taskDeclared: [{ type: 'network', posture: 'full' }],
      toolRequired: [{ type: 'network', posture: 'full' }],
    });

    expect(intersection).toContainEqual({ type: 'network', posture: 'full' });
  });
});
