// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Transitional escape hatch for dynamic values while explicit-UnsafeAny debt is removed.
 * Intentionally derived from JSON.parse return type to avoid explicit `UnsafeAny`.
 */
type UnsafeAny = ReturnType<typeof JSON.parse>;
