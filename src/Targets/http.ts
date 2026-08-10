/** HTTP helpers shared by the adapters that speak REST directly (Floppy, mdblist). */

/**
 * Narrows an unknown value to an indexable object. Arrays pass this guard on purpose,
 * since the readers below walk payloads of unknown shape. `GetAndValidateConfigs` has
 * its own stricter variant that excludes them, because no config block is an array.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads a response body as JSON, or null when there is none. A 204 carries no body and
 * an infrastructure error may return HTML; in both cases the status reports the problem,
 * so a missing body is not itself an error.
 */
export const readPayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * Formats the reason an API returned alongside an error status, ready to append to an
 * error message. `key` is backend-specific: Floppy uses `detail`, mdblist uses `error`.
 */
export const detailOf = (payload: unknown, key: string): string => {
  const reason = isRecord(payload) ? payload[key] : undefined;
  return typeof reason === 'string' ? `: ${reason}` : '';
};
