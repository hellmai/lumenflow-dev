// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIR, '..');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');

interface PackageJsonShape {
  dependencies?: Record<string, string>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as PackageJsonShape;
}

function runKernelParityTypecheck(): void {
  const parityPath = path.join(PACKAGE_ROOT, 'src', '.tmp-kernel-parity.ts');
  const paritySnippet = [
    "import type { KernelEvent as KernelEventFromKernel } from '../../kernel/src/kernel.schemas.js';",
    "import type { SdkKernelEvent } from './sync-port.js';",
    'type KernelToSdkParity = [KernelEventFromKernel] extends [SdkKernelEvent] ? true : never;',
    'const kernelToSdkParity: KernelToSdkParity = true;',
    'void kernelToSdkParity;',
  ].join('\n');

  try {
    writeFileSync(parityPath, paritySnippet, 'utf8');
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsc',
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--skipLibCheck',
        parityPath,
      ],
      {
        cwd: PACKAGE_ROOT,
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(parityPath, { force: true });
  }
}

function readPackedPackageJson(): PackageJsonShape {
  const packDir = mkdtempSync(path.join(tmpdir(), 'lumenflow-pack-'));

  try {
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: PACKAGE_ROOT,
      stdio: 'pipe',
    });

    const tarballName = readdirSync(packDir).find((entry) => entry.endsWith('.tgz'));
    if (!tarballName) {
      throw new Error(`No tarball created in ${packDir}`);
    }

    const tarballPath = path.join(packDir, tarballName);
    const packedJson = execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    return JSON.parse(packedJson) as PackageJsonShape;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

describe('sdk packaging boundary', () => {
  it('removes kernel from runtime dependencies', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.['@lumenflow/kernel']).toBeUndefined();
  });

  it('keeps compile-time kernel parity checks in monorepo CI', () => {
    expect(runKernelParityTypecheck).not.toThrow();
  });

  it('produces a packed artifact without kernel runtime dependency', () => {
    const packed = readPackedPackageJson();
    expect(packed.dependencies?.['@lumenflow/kernel']).toBeUndefined();
  });
});
