// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createError, ErrorCodes } from '@lumenflow/core';

/**
 * Validator Registry
 *
 * WU-1550: Declarative validator registration pattern.
 *
 * Instead of importing and calling validators individually in wu-done.ts,
 * validators register themselves with ValidatorRegistry. New validators
 * can be added by creating a file and calling registry.register()
 * without modifying the wu-done orchestration code.
 *
 * @module validator-registry
 */

/**
 * Phase in the wu-done lifecycle where a validator runs.
 */
export type ValidatorPhase = 'preflight' | 'completion';

/**
 * Definition of a single validator.
 */
export interface ValidatorDefinition {
  /** Unique validator name */
  name: string;

  /** Phase when this validator should run */
  phase: ValidatorPhase;

  /** Validation function. Returns { valid, errors } or { valid, warnings }. */
  validate: (...args: unknown[]) => unknown;

  /**
   * Whether failures from this validator should block wu-done.
   * Defaults to true (blocking).
   */
  blocking?: boolean;
}

/**
 * Registry for wu-done validators.
 *
 * Validators are registered with a phase (preflight or completion) and
 * executed in insertion order within each phase.
 */
export class ValidatorRegistry {
  private readonly validators: ValidatorDefinition[] = [];
  private readonly nameIndex = new Map<string, number>();

  /**
   * Register a single validator definition.
   *
   * @param validator - Validator definition to register
   * @throws Error if a validator with the same name is already registered
   */
  register(validator: ValidatorDefinition): void {
    if (this.nameIndex.has(validator.name)) {
      throw createError(
        ErrorCodes.TOOL_ALREADY_REGISTERED,
        `Validator "${validator.name}" is already registered`,
      );
    }
    this.nameIndex.set(validator.name, this.validators.length);
    this.validators.push(validator);
  }

  /**
   * Get validators for a specific phase, in insertion order.
   *
   * @param phase - Phase to filter by
   * @returns Copy of the validators for the given phase
   */
  getByPhase(phase: ValidatorPhase): ValidatorDefinition[] {
    return this.validators.filter((v) => v.phase === phase).map((v) => ({ ...v }));
  }

  /**
   * Get all registered validators across all phases.
   *
   * @returns Copy of all validators
   */
  getAll(): ValidatorDefinition[] {
    return [...this.validators];
  }

  /**
   * Check if a validator with the given name is registered.
   *
   * @param name - Validator name to check
   * @returns true if the validator exists
   */
  has(name: string): boolean {
    return this.nameIndex.has(name);
  }

  /**
   * Get all phases that have at least one registered validator.
   *
   * @returns Array of phase names
   */
  getPhases(): ValidatorPhase[] {
    const phases = new Set<ValidatorPhase>();
    for (const v of this.validators) {
      phases.add(v.phase);
    }
    return [...phases];
  }

  /**
   * Remove all registered validators.
   */
  clear(): void {
    this.validators.length = 0;
    this.nameIndex.clear();
  }
}
