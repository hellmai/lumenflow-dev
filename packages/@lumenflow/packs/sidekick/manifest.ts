// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { SIDEKICK_PACK_ID, SIDEKICK_PACK_VERSION, SIDEKICK_POLICY_ID_PREFIX } from './constants.js';
import {
  MANIFEST_POLICY_DECISIONS,
  MANIFEST_POLICY_TRIGGERS,
  SidekickManifestSchema,
  type SidekickManifestTool,
  type SidekickPackManifest,
} from './manifest-schema.js';
import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  type PathScope,
  type ToolPermission,
} from './tools/types.js';

// ---------------------------------------------------------------------------
// Scope constants
// ---------------------------------------------------------------------------

const SIDEKICK_SCOPE_READ: PathScope = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/**',
  access: TOOL_SCOPE_ACCESS.READ,
};

const SIDEKICK_SCOPE_WRITE: PathScope = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
};

// ---------------------------------------------------------------------------
// 16-tool contract (per strategy: 5 groups)
// ---------------------------------------------------------------------------

const TOOL_PERMISSIONS_MAP = {
  // Task tools (4)
  'task:create': TOOL_PERMISSIONS.WRITE,
  'task:list': TOOL_PERMISSIONS.READ,
  'task:complete': TOOL_PERMISSIONS.WRITE,
  'task:schedule': TOOL_PERMISSIONS.WRITE,
  // Memory tools (3)
  'memory:store': TOOL_PERMISSIONS.WRITE,
  'memory:recall': TOOL_PERMISSIONS.READ,
  'memory:forget': TOOL_PERMISSIONS.WRITE,
  // Channel tools (3)
  'channel:configure': TOOL_PERMISSIONS.WRITE,
  'channel:send': TOOL_PERMISSIONS.WRITE,
  'channel:receive': TOOL_PERMISSIONS.READ,
  // Routine tools (3)
  'routine:create': TOOL_PERMISSIONS.WRITE,
  'routine:list': TOOL_PERMISSIONS.READ,
  'routine:run': TOOL_PERMISSIONS.READ, // plan-only, no execution
  // System tools (3)
  'sidekick:init': TOOL_PERMISSIONS.WRITE,
  'sidekick:status': TOOL_PERMISSIONS.READ,
  'sidekick:export': TOOL_PERMISSIONS.READ, // returns data, no file write
} as const satisfies Record<string, ToolPermission>;

type SidekickToolName = keyof typeof TOOL_PERMISSIONS_MAP;

const TASK_TOOLS_ENTRY = 'tool-impl/task-tools.ts';
const MEMORY_TOOLS_ENTRY = 'tool-impl/memory-tools.ts';
const CHANNEL_TOOLS_ENTRY = 'tool-impl/channel-tools.ts';
const ROUTINE_TOOLS_ENTRY = 'tool-impl/routine-tools.ts';
const SYSTEM_TOOLS_ENTRY = 'tool-impl/system-tools.ts';

const TOOL_ENTRIES: Record<SidekickToolName, string> = {
  'task:create': TASK_TOOLS_ENTRY,
  'task:list': TASK_TOOLS_ENTRY,
  'task:complete': TASK_TOOLS_ENTRY,
  'task:schedule': TASK_TOOLS_ENTRY,
  'memory:store': MEMORY_TOOLS_ENTRY,
  'memory:recall': MEMORY_TOOLS_ENTRY,
  'memory:forget': MEMORY_TOOLS_ENTRY,
  'channel:configure': CHANNEL_TOOLS_ENTRY,
  'channel:send': CHANNEL_TOOLS_ENTRY,
  'channel:receive': CHANNEL_TOOLS_ENTRY,
  'routine:create': ROUTINE_TOOLS_ENTRY,
  'routine:list': ROUTINE_TOOLS_ENTRY,
  'routine:run': ROUTINE_TOOLS_ENTRY,
  'sidekick:init': SYSTEM_TOOLS_ENTRY,
  'sidekick:status': SYSTEM_TOOLS_ENTRY,
  'sidekick:export': SYSTEM_TOOLS_ENTRY,
};

// ---------------------------------------------------------------------------
// Input schemas (JSON Schema objects)
// ---------------------------------------------------------------------------

const TOOL_INPUT_SCHEMAS: Record<SidekickToolName, Record<string, unknown>> = {
  'task:create': {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      due_at: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      dry_run: { type: 'boolean' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  'task:list': {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'done'] },
      priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      tags: { type: 'array', items: { type: 'string' } },
      search: { type: 'string' },
      due_before: { type: 'string' },
      limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  },
  'task:complete': {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      note: { type: 'string' },
      dry_run: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  'task:schedule': {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      due_at: { type: 'string' },
      cron: { type: 'string' },
      dry_run: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  'memory:store': {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['fact', 'preference', 'note', 'snippet'] },
      content: { type: 'string', minLength: 1 },
      tags: { type: 'array', items: { type: 'string' } },
      dry_run: { type: 'boolean' },
    },
    required: ['type', 'content'],
    additionalProperties: false,
  },
  'memory:recall': {
    type: 'object',
    properties: {
      query: { type: 'string' },
      type: { type: 'string', enum: ['fact', 'preference', 'note', 'snippet'] },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  },
  'memory:forget': {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      dry_run: { type: 'boolean' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  'channel:configure': {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      type: { type: 'string', enum: ['terminal'] },
      dry_run: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  'channel:send': {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      content: { type: 'string', minLength: 1 },
      sender: { type: 'string' },
      dry_run: { type: 'boolean' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  'channel:receive': {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      limit: { type: 'integer', minimum: 1 },
      since: { type: 'string' },
    },
    additionalProperties: false,
  },
  'routine:create': {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', minLength: 1 },
            input: { type: 'object', additionalProperties: true },
          },
          required: ['tool'],
          additionalProperties: false,
        },
      },
      cron: { type: 'string' },
      enabled: { type: 'boolean' },
      dry_run: { type: 'boolean' },
    },
    required: ['name', 'steps'],
    additionalProperties: false,
  },
  'routine:list': {
    type: 'object',
    properties: {
      enabled_only: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  },
  'routine:run': {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    required: ['id'],
    additionalProperties: false,
  },
  'sidekick:init': {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  'sidekick:status': {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  'sidekick:export': {
    type: 'object',
    properties: {
      include_audit: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Generic output schema
// ---------------------------------------------------------------------------

const GENERIC_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: { type: 'object', additionalProperties: true },
    error: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
};

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function resolveRequiredScopes(permission: ToolPermission): PathScope[] {
  if (permission === TOOL_PERMISSIONS.READ) {
    return [SIDEKICK_SCOPE_READ];
  }
  return [SIDEKICK_SCOPE_READ, SIDEKICK_SCOPE_WRITE];
}

function buildTool(name: SidekickToolName): SidekickManifestTool {
  const permission = TOOL_PERMISSIONS_MAP[name];
  return {
    name,
    entry: TOOL_ENTRIES[name],
    permission,
    required_scopes: resolveRequiredScopes(permission),
    input_schema: TOOL_INPUT_SCHEMAS[name],
    output_schema: GENERIC_OUTPUT_SCHEMA,
  };
}

// ---------------------------------------------------------------------------
// Exported manifest
// ---------------------------------------------------------------------------

export const SIDEKICK_TOOL_NAMES = Object.keys(TOOL_PERMISSIONS_MAP) as SidekickToolName[];

const SIDEKICK_MANIFEST_TEMPLATE = {
  id: SIDEKICK_PACK_ID,
  version: SIDEKICK_PACK_VERSION,
  config_key: SIDEKICK_PACK_ID,
  task_types: ['sidekick'],
  tools: SIDEKICK_TOOL_NAMES.map((name) => buildTool(name)),
  policies: [
    {
      id: `${SIDEKICK_POLICY_ID_PREFIX}.default`,
      trigger: MANIFEST_POLICY_TRIGGERS.ON_TOOL_REQUEST,
      decision: MANIFEST_POLICY_DECISIONS.ALLOW,
      reason: 'Default sidekick policy permits declared tools within scoped access.',
    },
  ],
  evidence_types: ['sidekick.audited.tool-call'],
  state_aliases: {},
  lane_templates: [],
};

export const SIDEKICK_MANIFEST: SidekickPackManifest = SidekickManifestSchema.parse(
  SIDEKICK_MANIFEST_TEMPLATE,
);

export function getSidekickManifestToolByName(name: string): SidekickManifestTool | undefined {
  return SIDEKICK_MANIFEST.tools.find((tool) => tool.name === name);
}

export function getSidekickToolCount(): number {
  return SIDEKICK_MANIFEST.tools.length;
}
