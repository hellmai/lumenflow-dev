// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SHA256_ALGORITHM, UTF8_ENCODING } from '../shared-constants.js';

const NULL_BYTE_BUFFER = Buffer.from([0]);
const DEFAULT_EXCLUSIONS = ['node_modules/', '.git/', 'dist/', '.DS_Store'];

export interface ComputeDeterministicPackHashInput {
  packRoot: string;
  exclusions?: string[];
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function shouldExclude(relativePath: string, exclusions: string[]): boolean {
  return exclusions.some((excluded) => {
    if (excluded.endsWith('/')) {
      return relativePath.startsWith(excluded);
    }
    return relativePath === excluded || relativePath.endsWith(`/${excluded}`);
  });
}

async function collectFilesRecursive(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];

  for (const entry of sortedEntries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = normalizeRelativePath(root, absolutePath);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursive(root, absolutePath)));
      continue;
    }
    files.push(relativePath);
  }

  return files;
}

export async function listPackFiles(
  packRoot: string,
  exclusions: string[] = DEFAULT_EXCLUSIONS,
): Promise<string[]> {
  const absoluteRoot = path.resolve(packRoot);
  const allFiles = await collectFilesRecursive(absoluteRoot, absoluteRoot);
  return allFiles.filter((relativePath) => !shouldExclude(relativePath, exclusions)).sort();
}

export async function computeDeterministicPackHash(
  input: ComputeDeterministicPackHashInput,
): Promise<string> {
  const absoluteRoot = path.resolve(input.packRoot);
  const files = await listPackFiles(absoluteRoot, input.exclusions || DEFAULT_EXCLUSIONS);
  const digestChunks: Buffer[] = [];

  for (const relativePath of files) {
    const fileContents = await readFile(path.join(absoluteRoot, relativePath));
    const fileHash = createHash(SHA256_ALGORITHM).update(fileContents).digest('hex');
    digestChunks.push(Buffer.from(relativePath, UTF8_ENCODING));
    digestChunks.push(NULL_BYTE_BUFFER);
    digestChunks.push(Buffer.from(fileHash, UTF8_ENCODING));
    digestChunks.push(NULL_BYTE_BUFFER);
  }

  return createHash(SHA256_ALGORITHM)
    .update(digestChunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(digestChunks))
    .digest('hex');
}
