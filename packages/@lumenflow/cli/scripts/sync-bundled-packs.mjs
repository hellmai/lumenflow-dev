#!/usr/bin/env node

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_PACKS_ROOT = path.resolve(CLI_ROOT, '..', 'packs');
const TARGET_PACKS_ROOT = path.resolve(CLI_ROOT, 'packs');

const SKIP_DIRECTORY_NAMES = new Set(['__tests__', 'node_modules', 'dist']);
const SKIP_FILE_SUFFIXES = ['.test.ts', '.spec.ts'];

function shouldCopyEntry(packSourceRoot, sourcePath) {
  const relativePath = path.relative(packSourceRoot, sourcePath);
  if (!relativePath) {
    return true;
  }

  const pathSegments = relativePath.split(path.sep);
  if (pathSegments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment))) {
    return false;
  }

  const fileName = path.basename(sourcePath);
  if (SKIP_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return false;
  }

  return true;
}

async function listPackDirectories(packsRoot) {
  const entries = await readdir(packsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRECTORY_NAMES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function syncBundledPacks() {
  const packDirectoryNames = await listPackDirectories(SOURCE_PACKS_ROOT);

  await rm(TARGET_PACKS_ROOT, { recursive: true, force: true });
  await mkdir(TARGET_PACKS_ROOT, { recursive: true });

  for (const packDirectoryName of packDirectoryNames) {
    const sourcePackRoot = path.join(SOURCE_PACKS_ROOT, packDirectoryName);
    const targetPackRoot = path.join(TARGET_PACKS_ROOT, packDirectoryName);
    await cp(sourcePackRoot, targetPackRoot, {
      recursive: true,
      filter: (sourcePath) => shouldCopyEntry(sourcePackRoot, sourcePath),
    });
  }

  console.log(
    `[sync:bundled-packs] Synced ${packDirectoryNames.length} pack(s) from ${SOURCE_PACKS_ROOT} to ${TARGET_PACKS_ROOT}`,
  );
}

void syncBundledPacks();
