import { describe, it, expect } from 'vitest';
import { isPrivate } from '../../src/Targets/privacy';

describe('isPrivate', () => {
  it('maps private to true', () => {
    expect(isPrivate('private')).toBe(true);
  });

  it('maps public, link and friends to false', () => {
    expect(isPrivate('public')).toBe(false);
    expect(isPrivate('link')).toBe(false);
    expect(isPrivate('friends')).toBe(false);
  });
});
