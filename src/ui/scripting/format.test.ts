import { formatLua } from './format';

describe('formatLua', () => {
  it('substitutes strings and integers', () => {
    expect(formatLua('Level %d %s', [1, 'WARRIOR'])).toBe('Level 1 WARRIOR');
  });

  it('handles the version line the glue screen prints', () => {
    expect(formatLua('%s %s (%s) (%s) %s', ['3.3.5', '12340', 'Mar 19 2010', '30300', 'Release'])).toBe(
      '3.3.5 12340 (Mar 19 2010) (30300) Release',
    );
  });

  it('truncates rather than rounds for %d', () => {
    expect(formatLua('%d', [3.9])).toBe('3');
    expect(formatLua('%d', [-3.9])).toBe('-3');
  });

  it('applies precision to floats', () => {
    expect(formatLua('%.2f', [3.14159])).toBe('3.14');
    expect(formatLua('%.0f', [2.5])).toBe('3');
  });

  it('pads to a width', () => {
    expect(formatLua('[%5d]', [42])).toBe('[   42]');
    expect(formatLua('[%-5d]', [42])).toBe('[42   ]');
    expect(formatLua('[%05d]', [42])).toBe('[00042]');
  });

  it('puts zero padding after the sign', () => {
    expect(formatLua('%05d', [-42])).toBe('-0042');
  });

  it('truncates strings with a precision', () => {
    expect(formatLua('%.3s', ['abcdef'])).toBe('abc');
  });

  it('formats hex in both cases', () => {
    expect(formatLua('%x %X', [255, 255])).toBe('ff FF');
  });

  it('emits a literal percent for %%', () => {
    expect(formatLua('100%%', [])).toBe('100%');
  });

  it('leaves the specifier in place when arguments run out', () => {
    // Better a visible mistake than the word "undefined" in the UI.
    expect(formatLua('%s and %s', ['one'])).toBe('one and %s');
  });

  it('passes through a template with no specifiers', () => {
    expect(formatLua('Enter World', [1, 2])).toBe('Enter World');
  });

  it('consumes arguments in order across mixed specifiers', () => {
    expect(formatLua('%s-%d-%.1f', ['a', 2, 3.45])).toBe('a-2-3.5');
  });
});
