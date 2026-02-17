import {
  SOFTWARE_DELIVERY_DOMAIN,
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  type ToolDescriptor,
} from './types.js';

const ADMIN_SCOPE = {
  type: 'path' as const,
  pattern: 'runtime/locks/**',
  access: 'write' as const,
};

export const laneLockAcquireTool: ToolDescriptor = {
  name: 'lane-lock:acquire',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [ADMIN_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/lane-lock.ts#acquireLaneLockTool',
  },
  description: 'Acquire an atomic lane lock for a work unit.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const laneLockReleaseTool: ToolDescriptor = {
  name: 'lane-lock:release',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [ADMIN_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/lane-lock.ts#releaseLaneLockTool',
  },
  description: 'Release a lane lock held by the current worker.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const laneLockToolCapabilities: readonly ToolDescriptor[] = [
  laneLockAcquireTool,
  laneLockReleaseTool,
];
