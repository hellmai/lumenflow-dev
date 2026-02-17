import {
  SOFTWARE_DELIVERY_DOMAIN,
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  type ToolDescriptor,
} from './types.js';

const WORKTREE_SCOPE = {
  type: 'path' as const,
  pattern: 'worktrees/**',
  access: 'write' as const,
};

export const worktreeListTool: ToolDescriptor = {
  name: 'worktree:list',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [WORKTREE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/worktree-tools.ts#listWorktreesTool',
  },
  description: 'List available git worktrees.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const worktreeCreateTool: ToolDescriptor = {
  name: 'worktree:create',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [WORKTREE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/worktree-tools.ts#createWorktreeTool',
  },
  description: 'Create a git worktree for a delegated unit of work.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const worktreeRemoveTool: ToolDescriptor = {
  name: 'worktree:remove',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [WORKTREE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/worktree-tools.ts#removeWorktreeTool',
  },
  description: 'Remove a git worktree after completion.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const worktreeToolCapabilities: readonly ToolDescriptor[] = [
  worktreeListTool,
  worktreeCreateTool,
  worktreeRemoveTool,
];
