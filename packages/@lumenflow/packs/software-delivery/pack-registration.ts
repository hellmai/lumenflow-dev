import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFTWARE_DELIVERY_MANIFEST, type SoftwareDeliveryPackManifest } from './manifest.js';

const NULL_BYTE_BUFFER = Buffer.from([0]);
const DEFAULT_EXCLUSIONS = ['node_modules/', '.git/', 'dist/', '.DS_Store'];

function getDefaultPackRoot(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function shouldExclude(relativePath: string, exclusions: readonly string[]): boolean {
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

async function listPackFiles(packRoot: string, exclusions: readonly string[]): Promise<string[]> {
  const absoluteRoot = path.resolve(packRoot);
  const allFiles = await collectFilesRecursive(absoluteRoot, absoluteRoot);
  return allFiles.filter((relativePath) => !shouldExclude(relativePath, exclusions)).sort();
}

export async function computeSoftwareDeliveryPackIntegrity(
  packRoot = getDefaultPackRoot(),
  exclusions: readonly string[] = DEFAULT_EXCLUSIONS,
): Promise<`sha256:${string}`> {
  const absoluteRoot = path.resolve(packRoot);
  const files = await listPackFiles(absoluteRoot, exclusions);
  const digestChunks: Buffer[] = [];

  for (const relativePath of files) {
    const fileContents = await readFile(path.join(absoluteRoot, relativePath));
    const fileHash = createHash('sha256').update(fileContents).digest('hex');
    digestChunks.push(Buffer.from(relativePath, 'utf8'));
    digestChunks.push(NULL_BYTE_BUFFER);
    digestChunks.push(Buffer.from(fileHash, 'utf8'));
    digestChunks.push(NULL_BYTE_BUFFER);
  }

  const combinedDigest = createHash('sha256')
    .update(digestChunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(digestChunks))
    .digest('hex');

  return `sha256:${combinedDigest}`;
}

export async function loadSoftwareDeliveryManifest(
  packRoot = getDefaultPackRoot(),
): Promise<SoftwareDeliveryPackManifest> {
  const manifestPath = path.join(path.resolve(packRoot), 'manifest.yaml');
  await readFile(manifestPath, 'utf8');
  return structuredClone(SOFTWARE_DELIVERY_MANIFEST);
}

export interface RegisteredSoftwareDeliveryPack {
  manifest: SoftwareDeliveryPackManifest;
  packRoot: string;
  manifestPath: string;
  integrity: `sha256:${string}`;
}

export async function registerSoftwareDeliveryPack(options?: {
  packRoot?: string;
  exclusions?: readonly string[];
}): Promise<RegisteredSoftwareDeliveryPack> {
  const packRoot = path.resolve(options?.packRoot ?? getDefaultPackRoot());
  const exclusions = options?.exclusions ?? DEFAULT_EXCLUSIONS;
  const manifest = await loadSoftwareDeliveryManifest(packRoot);
  const integrity = await computeSoftwareDeliveryPackIntegrity(packRoot, exclusions);

  return {
    manifest,
    packRoot,
    manifestPath: path.join(packRoot, 'manifest.yaml'),
    integrity,
  };
}
