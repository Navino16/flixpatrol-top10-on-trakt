import { describe, it, expect } from 'vitest';
import { detailOf, isRecord, readPayload } from '../../src/Targets/http';

const response = (body: () => Promise<unknown>) => ({ json: body } as unknown as Response);

describe('isRecord', () => {
  it('accepts plain objects and arrays', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1, 2])).toBe(true);
  });

  it('rejects null and primitives', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('text')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('readPayload', () => {
  it('returns the parsed body', async () => {
    expect(await readPayload(response(async () => ({ id: 1 })))).toEqual({ id: 1 });
  });

  it('returns null when the body is not JSON, so the status can report the failure', async () => {
    expect(await readPayload(response(async () => {
      throw new SyntaxError('Unexpected token <');
    }))).toBeNull();
  });
});

describe('detailOf', () => {
  it('formats the reason found under the backend-specific key', () => {
    expect(detailOf({ detail: 'Not found' }, 'detail')).toBe(': Not found');
    expect(detailOf({ error: 'Invalid API key' }, 'error')).toBe(': Invalid API key');
  });

  it('returns an empty string when the key is absent, non-string or the payload is not an object', () => {
    expect(detailOf({ error: 'boom' }, 'detail')).toBe('');
    expect(detailOf({ detail: 500 }, 'detail')).toBe('');
    expect(detailOf(null, 'detail')).toBe('');
    expect(detailOf('<html>', 'detail')).toBe('');
  });
});
