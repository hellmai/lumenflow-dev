// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import micromatch from 'micromatch';
import type { ToolScope } from '../kernel.schemas.js';

type PathScope = Extract<ToolScope, { type: 'path' }>;
type NetworkScope = Extract<ToolScope, { type: 'network' }>;
type PathAccess = PathScope['access'];

export interface ScopeIntersectionInput {
  workspaceAllowed: ToolScope[];
  laneAllowed: ToolScope[];
  taskDeclared: ToolScope[];
  toolRequired: ToolScope[];
}

function toPathScopes(scopes: ToolScope[], access: PathAccess): PathScope[] {
  return scopes.filter(
    (scope): scope is PathScope => scope.type === 'path' && scope.access === access,
  );
}

function toNetworkScopes(scopes: ToolScope[]): NetworkScope[] {
  return scopes.filter((scope): scope is NetworkScope => scope.type === 'network');
}

function patternContains(containerPattern: string, nestedPattern: string): boolean {
  const testPath = nestedPattern
    .replace(/\*\*/g, '__nested__/__path__')
    .replace(/\*/g, '__segment__');
  return micromatch.isMatch(testPath, containerPattern);
}

function patternsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    patternContains(left, right) ||
    patternContains(right, left) ||
    micromatch.isMatch(right, left) ||
    micromatch.isMatch(left, right)
  );
}

function allPatternsOverlap(patterns: string[]): boolean {
  for (let i = 0; i < patterns.length; i += 1) {
    const left = patterns[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < patterns.length; j += 1) {
      const right = patterns[j];
      if (right === undefined) {
        continue;
      }
      if (!patternsOverlap(left, right)) {
        return false;
      }
    }
  }
  return true;
}

function specificityScore(pattern: string): number {
  const literalLength = pattern.replace(/[*[\]{}()!?+@]/g, '').length;
  const wildcardCount = (pattern.match(/\*/g) ?? []).length;
  return literalLength - wildcardCount * 5;
}

function selectNarrowestPattern(patterns: string[]): string {
  return (
    [...patterns].sort((left, right) => specificityScore(right) - specificityScore(left))[0] ??
    patterns[0] ??
    ''
  );
}

function intersectPathScopes(
  workspaceAllowed: ToolScope[],
  laneAllowed: ToolScope[],
  taskDeclared: ToolScope[],
  toolRequired: ToolScope[],
  access: PathAccess,
): PathScope[] {
  const workspace = toPathScopes(workspaceAllowed, access);
  const lane = toPathScopes(laneAllowed, access);
  const task = toPathScopes(taskDeclared, access);
  const tool = toPathScopes(toolRequired, access);

  if (workspace.length === 0 || lane.length === 0 || task.length === 0 || tool.length === 0) {
    return [];
  }

  const scopes = new Map<string, PathScope>();

  for (const toolScope of tool) {
    for (const workspaceScope of workspace) {
      if (!patternsOverlap(toolScope.pattern, workspaceScope.pattern)) {
        continue;
      }
      for (const laneScope of lane) {
        if (!patternsOverlap(toolScope.pattern, laneScope.pattern)) {
          continue;
        }
        for (const taskScope of task) {
          if (!patternsOverlap(toolScope.pattern, taskScope.pattern)) {
            continue;
          }
          const candidates = [
            workspaceScope.pattern,
            laneScope.pattern,
            taskScope.pattern,
            toolScope.pattern,
          ];
          if (!allPatternsOverlap(candidates)) {
            continue;
          }
          const pattern = selectNarrowestPattern(candidates);
          const dedupeKey = `${access}:${pattern}`;
          scopes.set(dedupeKey, {
            type: 'path',
            access,
            pattern,
          });
        }
      }
    }
  }

  return [...scopes.values()];
}

function intersectNetworkScopes(
  workspaceAllowed: ToolScope[],
  laneAllowed: ToolScope[],
  taskDeclared: ToolScope[],
  toolRequired: ToolScope[],
): NetworkScope[] {
  const workspace = toNetworkScopes(workspaceAllowed);
  const lane = toNetworkScopes(laneAllowed);
  const task = toNetworkScopes(taskDeclared);
  const tool = toNetworkScopes(toolRequired);

  if (workspace.length === 0 || lane.length === 0 || task.length === 0 || tool.length === 0) {
    return [];
  }

  const scopes = new Map<NetworkScope['posture'], NetworkScope>();
  for (const toolScope of tool) {
    const posture = toolScope.posture;
    if (
      workspace.some((scope) => scope.posture === posture) &&
      lane.some((scope) => scope.posture === posture) &&
      task.some((scope) => scope.posture === posture)
    ) {
      scopes.set(posture, {
        type: 'network',
        posture,
      });
    }
  }

  return [...scopes.values()];
}

export function intersectToolScopes(input: ScopeIntersectionInput): ToolScope[] {
  const readPaths = intersectPathScopes(
    input.workspaceAllowed,
    input.laneAllowed,
    input.taskDeclared,
    input.toolRequired,
    'read',
  );
  const writePaths = intersectPathScopes(
    input.workspaceAllowed,
    input.laneAllowed,
    input.taskDeclared,
    input.toolRequired,
    'write',
  );
  const network = intersectNetworkScopes(
    input.workspaceAllowed,
    input.laneAllowed,
    input.taskDeclared,
    input.toolRequired,
  );

  return [...readPaths, ...writePaths, ...network];
}
