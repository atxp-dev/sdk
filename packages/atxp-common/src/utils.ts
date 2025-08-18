/**
 * Exhaustiveness check for switch statements.
 * This function should never be called at runtime.
 * It's used to ensure all cases of a union type or enum are handled.
 * 
 * @param value - The value that should have been handled by all cases
 * @param message - Optional error message
 * @throws {Error} Always throws an error indicating unhandled case
 */
export function assertNever(value: never, message?: string): never {
  const errorMessage = message || `Unhandled case: ${JSON.stringify(value)}`;
  throw new Error(errorMessage);
}

/**
 * Type-safe way to check if a value is one of the enum values.
 * 
 * @param enumObj - The enum object
 * @param value - The value to check
 * @returns True if the value is a valid enum value
 */
export function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
} 