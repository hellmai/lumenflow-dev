// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gate Registry
 *
 * WU-1550: Declarative gate registration pattern.
 *
 * Instead of hardcoding gate arrays inside executeGates(), gates are registered
 * via GateRegistry. New gates can be added by calling registry.register()
 * without modifying the core execution code.
 *
 * @module gate-registry
 */

import { createError, ErrorCodes } from '@lumenflow/core';
import type { GateLogContext } from './gates-utils.js';

// Re-export so existing consumers of gate-registry.ts keep working.
export type { GateLogContext };

/**
 * Definition of a single gate.
 *
 * A gate must have either a `cmd` (shell command or sentinel) or a `run`
 * function, but not both are required -- one suffices.
 */
export interface GateDefinition {
  /** Unique gate name (e.g., 'lint', 'format:check') */
  name: string;

  /** Shell command or sentinel string to execute */
  cmd?: string;

  /** Async function to execute the gate */
  run?: (
    ctx: GateLogContext,
  ) => Promise<{ ok: boolean; duration: number; filesChecked?: string[] }>;

  /** Package.json script name for graceful degradation checks */
  scriptName?: string;

  /** When true, gate failures produce warnings instead of blocking */
  warnOnly?: boolean;
}

/**
 * Registry for quality gates.
 *
 * Gates are registered in order and executed sequentially.
 * New gates can be added by calling `register()` without modifying
 * the core executeGates() function.
 */
export class GateRegistry {
  private readonly gates: GateDefinition[] = [];
  private readonly nameIndex = new Map<string, number>();

  /**
   * Register a single gate definition.
   *
   * @param gate - Gate definition to register
   * @throws Error if a gate with the same name is already registered
   */
  register(gate: GateDefinition): void {
    if (this.nameIndex.has(gate.name)) {
      throw createError(
        ErrorCodes.TOOL_ALREADY_REGISTERED,
        `Gate "${gate.name}" is already registered`,
      );
    }
    this.nameIndex.set(gate.name, this.gates.length);
    this.gates.push(gate);
  }

  /**
   * Register multiple gate definitions at once.
   *
   * @param gates - Array of gate definitions to register
   */
  registerAll(gates: GateDefinition[]): void {
    for (const gate of gates) {
      this.register(gate);
    }
  }

  /**
   * Get all registered gates in insertion order.
   *
   * @returns Copy of the gates array
   */
  getAll(): GateDefinition[] {
    return [...this.gates];
  }

  /**
   * Get a gate by name.
   *
   * @param name - Gate name to look up
   * @returns Gate definition or undefined if not found
   */
  get(name: string): GateDefinition | undefined {
    const index = this.nameIndex.get(name);
    if (index === undefined) return undefined;
    return this.gates[index];
  }

  /**
   * Check if a gate with the given name is registered.
   *
   * @param name - Gate name to check
   * @returns true if the gate exists
   */
  has(name: string): boolean {
    return this.nameIndex.has(name);
  }

  /**
   * Remove all registered gates.
   */
  clear(): void {
    this.gates.length = 0;
    this.nameIndex.clear();
  }
}
