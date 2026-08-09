/**
 * HTTP helpers shared by the adapters that speak REST directly (Floppy,
 * mdblist). They deliberately stop short of the `request` methods themselves:
 * those differ in authentication, base URL and error class, and generalising
 * them would need injected error constructors for exactly two callers.
 */

/**
 * Narrows an unknown value to an indexable object.
 *
 * Arrays pass this guard on purpose: the response readers below walk payloads
 * whose shape is unknown, and rejecting arrays here would only move the check
 * to every call site. `GetAndValidateConfigs` keeps its own stricter variant,
 * which excludes arrays, because it inspects a configuration tree where an
 * array is never a valid block.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads a response body as JSON, or null when there is none.
 *
 * A 204 has no body, and an infrastructure error can return HTML: in both cases
 * the absence of JSON is not an error in itself, it will be reported by the
 * status.
 */
export const readPayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * Formats the human-readable reason an API returned alongside an error status,
 * ready to be appended to an error message. `key` is backend-specific: Floppy
 * reports it under `detail`, mdblist under `error`.
 */
export const detailOf = (payload: unknown, key: string): string => {
  const reason = isRecord(payload) ? payload[key] : undefined;
  return typeof reason === 'string' ? `: ${reason}` : '';
};
