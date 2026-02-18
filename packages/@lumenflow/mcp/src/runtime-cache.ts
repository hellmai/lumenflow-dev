import path from 'node:path';
import { initializeKernelRuntime } from '@lumenflow/kernel';

export type RuntimeInstance = Awaited<ReturnType<typeof initializeKernelRuntime>>;
type RuntimeToolCapabilityResolver = Parameters<
  typeof initializeKernelRuntime
>[0]['toolCapabilityResolver'];

const runtimeCacheByWorkspaceRoot = new Map<string, Promise<RuntimeInstance>>();

export function resetMcpRuntimeCache(): void {
  runtimeCacheByWorkspaceRoot.clear();
}

export async function getRuntimeForWorkspace(
  workspaceRoot: string,
  toolCapabilityResolver: RuntimeToolCapabilityResolver,
): Promise<RuntimeInstance> {
  const normalizedRoot = path.resolve(workspaceRoot);
  const cachedRuntime = runtimeCacheByWorkspaceRoot.get(normalizedRoot);
  if (cachedRuntime) {
    return cachedRuntime;
  }

  const runtimePromise = initializeKernelRuntime({
    workspaceRoot: normalizedRoot,
    toolCapabilityResolver,
  });
  runtimeCacheByWorkspaceRoot.set(normalizedRoot, runtimePromise);

  try {
    return await runtimePromise;
  } catch (cause) {
    runtimeCacheByWorkspaceRoot.delete(normalizedRoot);
    throw cause;
  }
}
