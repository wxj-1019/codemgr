import { describe, it, expect } from 'vitest';
import { mostCommonName } from '../src/lib/batchKill';

describe('mostCommonName', () => {
  it('returns null for empty list', () => {
    expect(mostCommonName([])).toBeNull();
  });

  it('returns null when all empty strings', () => {
    expect(mostCommonName(['', ''])).toBeNull();
  });

  it('returns single name', () => {
    expect(mostCommonName(['node.exe'])).toBe('node.exe');
  });

  it('returns most frequent', () => {
    expect(mostCommonName(['a', 'b', 'a', 'c', 'a'])).toBe('a');
  });

  it('tie broken by first to reach peak', () => {
    // a reaches 2 first, b reaches 2 later → a wins
    expect(mostCommonName(['a', 'a', 'b', 'b'])).toBe('a');
  });

  it('filters empty strings', () => {
    expect(mostCommonName(['', 'node.exe', '', 'node.exe'])).toBe('node.exe');
  });
});
