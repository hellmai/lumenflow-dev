// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LoadToolImplementationInput {
  entry: string;
  caller: 'worker' | 'host';
}

export type ToolImplementationFn = (...args: unknown[]) => unknown;

function parseEntry(entry: string): { modulePath: string; exportName: string } {
  const separator = entry.indexOf('#');
  if (separator < 1 || separator === entry.length - 1) {
    throw new Error(`Invalid tool entry "${entry}". Expected "<module>#<export>".`);
  }

  return {
    modulePath: entry.slice(0, separator),
    exportName: entry.slice(separator + 1),
  };
}

function resolveEntryPath(modulePath: string): string {
  if (!modulePath.startsWith('tool-impl/')) {
    throw new Error(`Invalid tool-impl module path "${modulePath}".`);
  }
  const toolImplRoot = path.dirname(fileURLToPath(import.meta.url));
  const packRoot = path.resolve(toolImplRoot, '..');
  return path.join(packRoot, modulePath);
}

export async function loadToolImplementation(
  input: LoadToolImplementationInput,
): Promise<ToolImplementationFn> {
  if (input.caller !== 'worker') {
    throw new Error('tool-impl modules can only be loaded by the tool-runner worker.');
  }

  const { modulePath, exportName } = parseEntry(input.entry);
  const absolutePath = resolveEntryPath(modulePath);
  const loadedModule = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  // eslint-disable-next-line security/detect-object-injection -- exportName comes from validated tool entry syntax
  const exported = loadedModule[exportName];

  if (typeof exported !== 'function') {
    throw new Error(`Entry "${input.entry}" did not resolve to a function export.`);
  }
  return exported as ToolImplementationFn;
}
