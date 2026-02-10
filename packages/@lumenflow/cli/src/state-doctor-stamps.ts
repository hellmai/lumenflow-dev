import path from 'node:path';
import fg from 'fast-glob';
import { listTrackedWUStampIds } from '@lumenflow/core/stamp-tracking';

/**
 * Resolve visible stamp IDs for lifecycle integrity checks.
 * Local untracked stamp files are ignored to avoid false-clean diagnostics.
 */
export async function resolveStateDoctorStampIds(
  baseDir: string,
  stampsDirConfigPath: string,
): Promise<string[]> {
  const stampsDir = path.join(baseDir, stampsDirConfigPath);
  const stampFiles = await fg('WU-*.done', { cwd: stampsDir });
  const stampIds = stampFiles.map((file) => file.replace('.done', ''));
  const trackedStampIds = await listTrackedWUStampIds({
    projectRoot: baseDir,
    stampsDir: stampsDirConfigPath,
  });
  if (trackedStampIds === null) {
    return stampIds;
  }
  return stampIds.filter((id) => trackedStampIds.has(id));
}
