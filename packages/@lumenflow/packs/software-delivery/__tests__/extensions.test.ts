// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_DELIVERY_EXTENSION_KEY,
  SoftwareDeliveryTaskExtensionsSchema,
  SoftwareDeliveryTaskSchema,
  extractSoftwareDeliveryExtensions,
} from '../extensions.js';

const validSoftwareDeliveryExtensions = {
  code_paths: ['packages/@lumenflow/cli/src/wu-done.ts'],
  tests: {
    unit: ['packages/@lumenflow/cli/src/__tests__/wu-done.test.ts'],
    e2e: ['packages/@lumenflow/cli/e2e/wu-done.e2e.test.ts'],
    manual: ['pnpm typecheck'],
  },
  exposure: 'backend-only',
  worktree: 'worktrees/framework-core-lifecycle-wu-1733',
  branch: 'lane/framework-core-lifecycle/wu-1733',
};

describe('software delivery task extensions', () => {
  it('validates extension schema fields', () => {
    const parsed = SoftwareDeliveryTaskExtensionsSchema.parse(validSoftwareDeliveryExtensions);

    expect(parsed.code_paths).toEqual(validSoftwareDeliveryExtensions.code_paths);
    expect(parsed.tests.manual).toContain('pnpm typecheck');
    expect(parsed.exposure).toBe('backend-only');
  });

  it('validates through TaskSpec.extensions-style opaque record', () => {
    const parsed = extractSoftwareDeliveryExtensions({
      [SOFTWARE_DELIVERY_EXTENSION_KEY]: validSoftwareDeliveryExtensions,
      arbitrary_domain: {
        unknown: true,
      },
    });

    expect(parsed.branch).toBe('lane/framework-core-lifecycle/wu-1733');
  });

  it('accepts software-delivery tasks and rejects unknown extension fields', () => {
    const parsedTask = SoftwareDeliveryTaskSchema.parse({
      domain: 'software-delivery',
      extensions: {
        [SOFTWARE_DELIVERY_EXTENSION_KEY]: validSoftwareDeliveryExtensions,
      },
    });

    expect(parsedTask.extensions.software_delivery).toEqual(validSoftwareDeliveryExtensions);

    expect(() =>
      SoftwareDeliveryTaskSchema.parse({
        domain: 'software-delivery',
        extensions: {
          [SOFTWARE_DELIVERY_EXTENSION_KEY]: {
            ...validSoftwareDeliveryExtensions,
            unexpected: 'value',
          },
        },
      }),
    ).toThrow(/unrecognized/i);
  });
});
