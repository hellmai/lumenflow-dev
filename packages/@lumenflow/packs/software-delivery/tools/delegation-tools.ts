import {
  SOFTWARE_DELIVERY_DOMAIN,
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  type ToolDescriptor,
} from './types.js';

const STATE_SCOPE = {
  type: 'path' as const,
  pattern: 'runtime/state/**',
  access: 'write' as const,
};

export const delegationRecordTool: ToolDescriptor = {
  name: 'delegation:record',
  domain: SOFTWARE_DELIVERY_DOMAIN,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  permission: 'admin',
  required_scopes: [STATE_SCOPE],
  handler: {
    kind: 'subprocess',
    entry: 'tool-impl/delegation-tools.ts#recordDelegationTool',
  },
  description: 'Append delegation lineage events for spawned sub-work.',
  pack: SOFTWARE_DELIVERY_PACK_ID,
};

export const delegationToolCapabilities: readonly ToolDescriptor[] = [delegationRecordTool];
