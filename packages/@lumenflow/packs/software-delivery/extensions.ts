import { SOFTWARE_DELIVERY_DOMAIN } from './constants.js';

export const SOFTWARE_DELIVERY_EXTENSION_KEY = 'software_delivery';
export const SOFTWARE_DELIVERY_EXPOSURES = ['ui', 'api', 'backend-only', 'documentation'] as const;

interface Parser<T> {
  parse(input: unknown): T;
}

export interface SoftwareDeliveryTests {
  unit: string[];
  e2e: string[];
  manual: string[];
}

export interface SoftwareDeliveryTaskExtensions {
  code_paths: string[];
  tests: SoftwareDeliveryTests;
  exposure: (typeof SOFTWARE_DELIVERY_EXPOSURES)[number];
  worktree: string;
  branch: string;
}

export interface SoftwareDeliveryTask {
  domain: typeof SOFTWARE_DELIVERY_DOMAIN;
  extensions: Record<string, unknown> & {
    [SOFTWARE_DELIVERY_EXTENSION_KEY]: SoftwareDeliveryTaskExtensions;
  };
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} has unrecognized key "${key}".`);
    }
  }
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => parseNonEmptyString(entry, `${label}[${index}]`));
}

function parseTests(input: unknown): SoftwareDeliveryTests {
  const tests = asRecord(input, 'tests');
  assertOnlyKeys(tests, ['unit', 'e2e', 'manual'], 'tests');
  return {
    unit: parseStringArray(tests.unit ?? [], 'tests.unit'),
    e2e: parseStringArray(tests.e2e ?? [], 'tests.e2e'),
    manual: parseStringArray(tests.manual ?? [], 'tests.manual'),
  };
}

const ExposureSet = new Set<string>(SOFTWARE_DELIVERY_EXPOSURES);

export const SoftwareDeliveryTaskExtensionsSchema: Parser<SoftwareDeliveryTaskExtensions> = {
  parse(input: unknown): SoftwareDeliveryTaskExtensions {
    const extension = asRecord(input, 'software delivery extension');
    assertOnlyKeys(
      extension,
      ['code_paths', 'tests', 'exposure', 'worktree', 'branch'],
      'software delivery extension',
    );

    const exposure = parseNonEmptyString(extension.exposure, 'exposure');
    if (!ExposureSet.has(exposure)) {
      throw new Error(`exposure must be one of: ${SOFTWARE_DELIVERY_EXPOSURES.join(', ')}`);
    }

    return {
      code_paths: parseStringArray(extension.code_paths, 'code_paths'),
      tests: parseTests(extension.tests),
      exposure: exposure as (typeof SOFTWARE_DELIVERY_EXPOSURES)[number],
      worktree: parseNonEmptyString(extension.worktree, 'worktree'),
      branch: parseNonEmptyString(extension.branch, 'branch'),
    };
  },
};

export const TaskExtensionsOpaqueRecordSchema: Parser<Record<string, unknown>> = {
  parse(input: unknown): Record<string, unknown> {
    return asRecord(input, 'extensions');
  },
};

export function extractSoftwareDeliveryExtensions(
  extensions: Record<string, unknown> | undefined,
): SoftwareDeliveryTaskExtensions {
  const parsedExtensions = TaskExtensionsOpaqueRecordSchema.parse(extensions ?? {});
  return SoftwareDeliveryTaskExtensionsSchema.parse(
    parsedExtensions[SOFTWARE_DELIVERY_EXTENSION_KEY],
  );
}

export const SoftwareDeliveryTaskSchema: Parser<SoftwareDeliveryTask> = {
  parse(input: unknown): SoftwareDeliveryTask {
    const task = asRecord(input, 'task');

    if (task.domain !== SOFTWARE_DELIVERY_DOMAIN) {
      throw new Error(`task.domain must be "${SOFTWARE_DELIVERY_DOMAIN}".`);
    }

    const parsedExtensions = TaskExtensionsOpaqueRecordSchema.parse(task.extensions);
    const parsedSoftwareDeliveryExtensions = SoftwareDeliveryTaskExtensionsSchema.parse(
      parsedExtensions[SOFTWARE_DELIVERY_EXTENSION_KEY],
    );

    return {
      domain: SOFTWARE_DELIVERY_DOMAIN,
      extensions: {
        ...parsedExtensions,
        [SOFTWARE_DELIVERY_EXTENSION_KEY]: parsedSoftwareDeliveryExtensions,
      },
    };
  },
};
