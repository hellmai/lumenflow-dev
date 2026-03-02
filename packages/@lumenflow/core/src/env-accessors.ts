// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createError, ErrorCodes } from './error-handler.js';
import type { EnvVarName } from './wu-context-constants.js';

export interface GetEnvOptions {
  env?: NodeJS.ProcessEnv;
  trim?: boolean;
}

export interface RequireEnvOptions extends GetEnvOptions {
  context?: string;
  remediation?: string;
}

const DEFAULT_REMEDIATION_SUFFIX = 'Set the environment variable and retry.';
const CONTEXT_SEPARATOR = ': ';

function getEnvSource(options: GetEnvOptions): NodeJS.ProcessEnv {
  return options.env ?? process.env;
}

export function getEnv(envVar: EnvVarName, options: GetEnvOptions = {}): string | undefined {
  const source = getEnvSource(options);
  const rawValue = source[envVar];
  if (rawValue === undefined) {
    return undefined;
  }

  const trimValue = options.trim ?? true;
  const normalizedValue = trimValue ? rawValue.trim() : rawValue;
  if (normalizedValue.length === 0) {
    return undefined;
  }

  return normalizedValue;
}

function formatContextPrefix(context?: string): string {
  if (!context) {
    return '';
  }
  return `${context}${CONTEXT_SEPARATOR}`;
}

export function requireEnv(envVar: EnvVarName, options: RequireEnvOptions = {}): string {
  const value = getEnv(envVar, options);
  if (value !== undefined) {
    return value;
  }

  const remediation = options.remediation ?? DEFAULT_REMEDIATION_SUFFIX;
  const contextPrefix = formatContextPrefix(options.context);
  throw createError(
    ErrorCodes.CONFIG_ERROR,
    `${contextPrefix}Missing required environment variable ${envVar}. ${remediation}`,
    { envVar, context: options.context },
  );
}
