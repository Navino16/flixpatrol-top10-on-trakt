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

/**
 * Statuses that condemn one request rather than the backend. A search answering any of
 * them says "this query is not answerable", so the item is dropped and the run goes on.
 *
 * Deliberately narrow: 401/403/429 and 5xx stay fatal. They would hit every item alike,
 * and a run that skipped them all would report success having written nothing.
 */
const UNSEARCHABLE_STATUS_CODES = new Set([400, 404, 422]);

/**
 * True when an error carries a status meaning the query itself was rejected. A transport
 * failure has no status and is therefore never unsearchable.
 */
export const isUnsearchable = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && UNSEARCHABLE_STATUS_CODES.has(status);
};
