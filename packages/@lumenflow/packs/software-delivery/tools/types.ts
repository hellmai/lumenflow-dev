import {
  SOFTWARE_DELIVERY_DOMAIN,
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
} from '../constants.js';

export interface PathScope {
  type: 'path';
  pattern: string;
  access: 'read' | 'write';
}

export interface ToolDescriptor {
  name: string;
  domain: typeof SOFTWARE_DELIVERY_DOMAIN;
  version: typeof SOFTWARE_DELIVERY_PACK_VERSION;
  permission: 'read' | 'write' | 'admin';
  required_scopes: PathScope[];
  handler: {
    kind: 'subprocess';
    entry: string;
  };
  description: string;
  pack: typeof SOFTWARE_DELIVERY_PACK_ID;
}

export { SOFTWARE_DELIVERY_DOMAIN, SOFTWARE_DELIVERY_PACK_ID, SOFTWARE_DELIVERY_PACK_VERSION };
