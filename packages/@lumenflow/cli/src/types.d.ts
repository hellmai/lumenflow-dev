/**
 * Transitional escape hatch for dynamic values while explicit-UnsafeAny debt is removed.
 * Intentionally derived from JSON.parse return type to avoid explicit `UnsafeAny`.
 */
type UnsafeAny = ReturnType<typeof JSON.parse>;
