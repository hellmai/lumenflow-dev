// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { ToolCapabilitySchema, type ToolCapability } from '../kernel.schemas.js';

export class ToolRegistry {
  private readonly capabilities = new Map<string, ToolCapability>();

  register(capability: unknown): ToolCapability {
    const validated = this.validate(capability);
    if (this.capabilities.has(validated.name)) {
      throw new Error(`Tool "${validated.name}" is already registered`);
    }
    this.capabilities.set(validated.name, validated);
    return validated;
  }

  lookup(name: string): ToolCapability | null {
    return this.capabilities.get(name) ?? null;
  }

  list(): ToolCapability[] {
    return [...this.capabilities.values()];
  }

  validate(capability: unknown): ToolCapability {
    const parsed = ToolCapabilitySchema.safeParse(capability);
    if (!parsed.success) {
      throw new Error(`ToolCapability validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
