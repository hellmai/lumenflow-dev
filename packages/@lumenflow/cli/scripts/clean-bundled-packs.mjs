#!/usr/bin/env node

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { constants as fsConstants } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(SCRIPT_DIR, '..');
const TARGET_PACKS_ROOT = path.resolve(CLI_ROOT, 'packs');
const LOG_PREFIX = '[clean:bundled-packs]';

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function cleanBundledPacks() {
  const hasGeneratedPacks = await pathExists(TARGET_PACKS_ROOT);
  if (!hasGeneratedPacks) {
    console.log(`${LOG_PREFIX} Nothing to clean at ${TARGET_PACKS_ROOT}`);
    return;
  }

  await rm(TARGET_PACKS_ROOT, { recursive: true, force: true });
  console.log(`${LOG_PREFIX} Removed generated bundled packs from ${TARGET_PACKS_ROOT}`);
}

void cleanBundledPacks();
