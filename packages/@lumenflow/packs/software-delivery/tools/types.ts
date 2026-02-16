export interface PathScope {
  type: 'path';
  pattern: string;
  access: 'read' | 'write';
}

export interface ToolDescriptor {
  name: string;
  domain: 'software-delivery';
  version: '0.1.0';
  permission: 'read' | 'write' | 'admin';
  required_scopes: PathScope[];
  handler: {
    kind: 'subprocess';
    entry: string;
  };
  description: string;
  pack: 'software-delivery';
}

export const SOFTWARE_DELIVERY_PACK_ID = 'software-delivery';
export const SOFTWARE_DELIVERY_PACK_VERSION = '0.1.0';
