// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createError, ErrorCodes } from './error-handler.js';
import type { EnvVarName } from './wu-context-constants.js';

const ISSUE_PREFIX = '- ';
const NEWLINE = '\n';
const RECEIVED_PREFIX = 'Received: ';
const MISSING_MESSAGE = 'Missing required value.';
const INVALID_MESSAGE = 'Invalid value.';

export const STARTUP_ENV_POLICY = {
  ERROR: 'error',
  WARN: 'warn',
} as const;

export type StartupEnvPolicy = (typeof STARTUP_ENV_POLICY)[keyof typeof STARTUP_ENV_POLICY];

interface EnvParseSuccess<T> {
  valid: true;
  value: T;
}

interface EnvParseFailure {
  valid: false;
  expected: string;
}

type EnvParseResult<T> = EnvParseSuccess<T> | EnvParseFailure;

export type EnvValueParser<T> = (rawValue: string) => EnvParseResult<T>;

export interface StartupEnvSchemaField<T> {
  envVar: EnvVarName;
  required?: boolean;
  defaultValue?: T;
  parse: EnvValueParser<T>;
}

export type StartupEnvSchema = Record<string, StartupEnvSchemaField<unknown>>;

export type StartupEnvValues<TSchema extends StartupEnvSchema> = {
  [Key in keyof TSchema]: TSchema[Key] extends StartupEnvSchemaField<infer TValue> ? TValue : never;
};

interface StartupEnvIssue {
  envVar: EnvVarName;
  message: string;
  expected?: string;
  received?: string;
}

export interface ValidateStartupEnvSchemaOptions<TSchema extends StartupEnvSchema> {
  context: string;
  env: NodeJS.ProcessEnv;
  schema: TSchema;
  policy?: StartupEnvPolicy;
  onWarning?: (diagnosticMessage: string) => void;
}

function formatIssueLine(issue: StartupEnvIssue): string {
  const fragments: string[] = [`${ISSUE_PREFIX}${issue.envVar}: ${issue.message}`];

  if (issue.expected) {
    fragments.push(`Expected ${issue.expected}.`);
  }

  if (issue.received !== undefined) {
    fragments.push(`${RECEIVED_PREFIX}"${issue.received}".`);
  }

  return fragments.join(' ');
}

function formatDiagnosticMessage(context: string, issues: StartupEnvIssue[]): string {
  const issueLines = issues.map(formatIssueLine).join(NEWLINE);
  return `${context} environment validation failed.${NEWLINE}${issueLines}`;
}

function assignFallbackValue(
  values: Record<string, unknown>,
  fieldName: string,
  field: StartupEnvSchemaField<unknown>,
): void {
  if (field.defaultValue !== undefined) {
    values[fieldName] = field.defaultValue;
  }
}

export function validateStartupEnvSchema<TSchema extends StartupEnvSchema>(
  options: ValidateStartupEnvSchemaOptions<TSchema>,
): StartupEnvValues<TSchema> {
  const policy = options.policy ?? STARTUP_ENV_POLICY.ERROR;
  const values: Record<string, unknown> = {};
  const issues: StartupEnvIssue[] = [];

  for (const [fieldName, field] of Object.entries(options.schema)) {
    const rawValue = options.env[field.envVar];

    if (rawValue === undefined) {
      if (field.required) {
        issues.push({
          envVar: field.envVar,
          message: MISSING_MESSAGE,
          expected: 'a non-empty value',
        });
      }
      assignFallbackValue(values, fieldName, field);
      continue;
    }

    const parsed = field.parse(rawValue);
    if (parsed.valid) {
      values[fieldName] = parsed.value;
      continue;
    }

    issues.push({
      envVar: field.envVar,
      message: INVALID_MESSAGE,
      expected: parsed.expected,
      received: rawValue,
    });
    assignFallbackValue(values, fieldName, field);
  }

  if (issues.length === 0) {
    return values as StartupEnvValues<TSchema>;
  }

  const diagnosticMessage = formatDiagnosticMessage(options.context, issues);
  if (policy === STARTUP_ENV_POLICY.WARN) {
    options.onWarning?.(diagnosticMessage);
    return values as StartupEnvValues<TSchema>;
  }

  throw createError(ErrorCodes.CONFIG_ERROR, diagnosticMessage, {
    context: options.context,
    issues,
  });
}

export function parseNonEmptyEnvValue(
  expectedDescription = 'a non-empty value',
): EnvValueParser<string> {
  return (rawValue: string): EnvParseResult<string> => {
    const trimmedValue = rawValue.trim();
    if (trimmedValue.length === 0) {
      return {
        valid: false,
        expected: expectedDescription,
      };
    }

    return {
      valid: true,
      value: trimmedValue,
    };
  };
}

export function parseEnumEnvValue<TAllowed extends readonly string[]>(
  allowedValues: TAllowed,
): EnvValueParser<TAllowed[number]> {
  const allowedSet = new Set<string>(allowedValues);
  const expected = `one of: ${allowedValues.join(', ')}`;

  return (rawValue: string): EnvParseResult<TAllowed[number]> => {
    const normalizedValue = rawValue.trim();
    if (allowedSet.has(normalizedValue)) {
      return {
        valid: true,
        value: normalizedValue as TAllowed[number],
      };
    }

    return {
      valid: false,
      expected,
    };
  };
}
