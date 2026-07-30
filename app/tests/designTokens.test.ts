import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

function variablesFor(selector: ':root' | ':root.light') {
  const escaped = selector.replace('.', '\\.');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing ${selector} token block`);

  return Object.fromEntries(
    [...match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((entry) => [entry[1], entry[2].trim()]),
  );
}

function rgb(value: string): [number, number, number] {
  const channels = value.split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some(Number.isNaN)) {
    throw new Error(`Expected RGB channels, received ${value}`);
  }
  return channels as [number, number, number];
}

function luminance(color: [number, number, number]) {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(left: [number, number, number], right: [number, number, number]) {
  const l1 = luminance(left);
  const l2 = luminance(right);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function composite(
  foreground: [number, number, number],
  background: [number, number, number],
  alpha: number,
): [number, number, number] {
  return foreground.map((channel, index) =>
    channel * alpha + background[index] * (1 - alpha),
  ) as [number, number, number];
}

describe('desktop workbench design tokens', () => {
  const dark = variablesFor(':root');
  const light = variablesFor(':root.light');

  it.each(['accent', 'focus', 'success', 'info', 'danger', 'warn'])(
    'provides a deeper light-theme %s color',
    (name) => {
      const token = `${name}-rgb`;
      expect(light[token]).toBeDefined();
      expect(luminance(rgb(light[token]))).toBeLessThan(luminance(rgb(dark[token])));
    },
  );

  it.each([
    ['dark', dark],
    ['light', { ...dark, ...light }],
  ] as const)('keeps %s content-muted readable for 12px body text', (_theme, tokens) => {
    expect(
      contrast(rgb(tokens['content-muted-rgb']), rgb(tokens['surface-canvas-rgb'])),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['dark', dark],
    ['light', { ...dark, ...light }],
  ] as const)('keeps %s on-accent text readable', (_theme, tokens) => {
    expect(contrast(rgb(tokens['on-accent-rgb']), rgb(tokens['accent-rgb']))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the light focus ring visible at its actual 70% opacity', () => {
    const tokens = { ...dark, ...light };
    const canvas = rgb(tokens['surface-canvas-rgb']);
    const renderedRing = composite(rgb(tokens['focus-rgb']), canvas, 0.7);

    expect(contrast(renderedRing, canvas)).toBeGreaterThanOrEqual(3);
  });
});
