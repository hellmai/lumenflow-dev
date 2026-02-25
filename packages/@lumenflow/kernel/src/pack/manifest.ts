// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { POLICY_TRIGGERS } from '../policy/policy-engine.js';
import { ToolScopeSchema } from '../kernel.schemas.js';

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const SEMVER_MESSAGE = 'Expected semantic version';
const NULL_BYTE = '\0';
const SCOPE_TRAVERSAL_PATTERN = /(^|\/)\.\.(\/|$)/;
const BROAD_WILDCARD_SCOPE_PATTERNS = new Set(['*', '**', '**/*', './**', './**/*']);

/**
 * JSON Schema representation for optional tool input/output declarations in pack manifests.
 * When present, the kernel uses these for validation instead of the default accept-anything schema.
 */
const JsonSchemaObjectSchema = z.record(z.string(), z.unknown());

export const DomainPackToolSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
  permission: z.enum(['read', 'write', 'admin']).default('read'),
  required_scopes: z.array(ToolScopeSchema).min(1),
  internal_only: z.boolean().optional(),
  /** Optional JSON Schema for tool input validation. */
  input_schema: JsonSchemaObjectSchema.optional(),
  /** Optional JSON Schema for tool output validation. */
  output_schema: JsonSchemaObjectSchema.optional(),
});

export type DomainPackTool = z.infer<typeof DomainPackToolSchema>;

export function isBroadWildcardScopePattern(pattern: string): boolean {
  return BROAD_WILDCARD_SCOPE_PATTERNS.has(pattern.trim());
}

export function hasUnsafeScopePattern(pattern: string): boolean {
  return pattern.includes(NULL_BYTE) || SCOPE_TRAVERSAL_PATTERN.test(pattern);
}

export function validateDomainPackToolSafety(tool: DomainPackTool): string[] {
  const issues: string[] = [];

  for (const scope of tool.required_scopes) {
    if (scope.type !== 'path') {
      continue;
    }
    if (hasUnsafeScopePattern(scope.pattern)) {
      issues.push(
        `scope pattern "${scope.pattern}" contains unsafe traversal or null-byte content`,
      );
    }
    if (
      (tool.permission === 'write' || tool.permission === 'admin') &&
      scope.access === 'write' &&
      isBroadWildcardScopePattern(scope.pattern)
    ) {
      issues.push(
        `scope pattern "${scope.pattern}" is too broad for ${tool.permission} permission and write access`,
      );
    }
  }

  const inputSchemaType = tool.input_schema?.type;
  if (inputSchemaType && inputSchemaType !== 'object') {
    issues.push(
      `input_schema.type must be "object" when provided, got "${String(inputSchemaType)}"`,
    );
  }

  const outputSchemaType = tool.output_schema?.type;
  if (outputSchemaType && outputSchemaType !== 'object') {
    issues.push(
      `output_schema.type must be "object" when provided, got "${String(outputSchemaType)}"`,
    );
  }

  return issues;
}

export const DomainPackPolicySchema = z.object({
  id: z.string().min(1),
  trigger: z.enum([
    POLICY_TRIGGERS.ON_TOOL_REQUEST,
    POLICY_TRIGGERS.ON_CLAIM,
    POLICY_TRIGGERS.ON_COMPLETION,
    POLICY_TRIGGERS.ON_EVIDENCE_ADDED,
  ]),
  decision: z.enum(['allow', 'deny']),
  reason: z.string().min(1).optional(),
});

export const DomainPackLaneTemplateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const DomainPackManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE),
  task_types: z.array(z.string().min(1)).min(1),
  tools: z.array(DomainPackToolSchema),
  policies: z.array(DomainPackPolicySchema),
  evidence_types: z.array(z.string().min(1)).default([]),
  state_aliases: z.record(z.string().min(1), z.string().min(1)).default({}),
  lane_templates: z.array(DomainPackLaneTemplateSchema).default([]),
  /** Root key in workspace.yaml that this pack owns for its configuration namespace. */
  config_key: z.string().min(1).optional(),
  /** Path to a JSON Schema file (relative to pack root) describing the pack config shape. */
  config_schema: z.string().optional(),
});

export type DomainPackManifest = z.infer<typeof DomainPackManifestSchema>;
