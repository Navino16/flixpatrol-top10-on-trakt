import { vi } from 'vitest';

export const PROCESS_EXIT_ERROR = 'process.exit called';

/**
 * Spies on `process.exit` so it throws instead of killing the test run.
 * The cast lives here once: `process.exit` returns `never`, which no mock
 * implementation can satisfy on its own.
 */
export function mockProcessExit() {
  return vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error(PROCESS_EXIT_ERROR);
  }) as unknown as typeof process.exit);
}
