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
      { type: 'path', pattern: 'docs/04-operations/**', access: 'read' },
      { type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'write' },
    ];
    const taskDeclared: ToolScope[] = [
      { type: 'path', pattern: 'docs/04-operations/tasks/**', access: 'read' },
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
      pattern: 'docs/04-operations/tasks/**',
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
});
