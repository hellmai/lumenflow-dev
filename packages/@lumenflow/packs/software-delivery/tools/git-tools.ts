import {
  SOFTWARE_DELIVERY_DOMAIN,
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  type ToolDescriptor,
} from './types.js';

const WRITE_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'write' as const,
};

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

export const gitAddTool: ToolDescriptor = {
  name: 'git:add',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'write',
  required_scopes: [WRITE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/git-tools.ts#gitAddTool',
  },
  description: 'Stage files for commit in a workspace git repository.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const gitStatusTool: ToolDescriptor = {
  name: 'git:status',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'read',
  required_scopes: [READ_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/git-tools.ts#gitStatusTool',
  },
  description: 'Inspect git status in a workspace git repository.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const gitCommitTool: ToolDescriptor = {
  name: 'git:commit',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'write',
  required_scopes: [WRITE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/git-tools.ts#gitCommitTool',
  },
  description: 'Create a commit for staged changes in a workspace git repository.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const gitToolCapabilities: readonly ToolDescriptor[] = [
  gitAddTool,
  gitStatusTool,
  gitCommitTool,
];
