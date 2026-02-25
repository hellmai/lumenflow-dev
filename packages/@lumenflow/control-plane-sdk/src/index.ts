// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import type { KernelEvent as KernelEventFromKernel } from '@lumenflow/kernel';
import type { KernelEvent as KernelEventFromSdk } from './sync-port.js';

type KernelEventTypeParity = [KernelEventFromSdk] extends [KernelEventFromKernel]
  ? [KernelEventFromKernel] extends [KernelEventFromSdk]
    ? true
    : never
  : never;

const kernelEventTypeParityCheck: KernelEventTypeParity = true;

export * from './sync-port.js';
export * from './workspace-config.js';
export * from './policy-mode.js';
export * from './http/http-control-plane-sync-port.js';
export * from './mock/mock-control-plane-sync-port.js';

void kernelEventTypeParityCheck;
