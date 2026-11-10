import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicBrand = 'apps/web/public/brand/';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const expected = {
  'VEREQO_LOCKUP_SOLID.svg': '839d2aa935261ecba5d7de740347aa82cf1e9dbe494c28e0f39163adfe7f4afa',
  'VEREQO_WORDMARK_SOLID.svg': '5bb4bc13c188200a36972791e00b6b98d3918893656c48d3b773bafb049be8ca',
  'VEREQO_ICON_SOLID.svg': '564d639addb665aabfe3a8393daa3adcb5f796e043922bee47dca849b041b9c1',
  'VEREQO_LOCKUP_SOLID_4X.png': 'e1dc11e64175799bccf5d387a2745c2680abdf84d2ad5a8c8d66837f8c2c3fcb',
  'VEREQO_LOCKUP_SOLID_WHITE_4X.png': 'd1cfdaf9391c5806260e7b623e9ae1705848fa718b7451dd3040612f1010d68c',
  'VEREQO_ICON_SOLID_4X.png': '608aa16acff7e6203f5b08c6249c4fc4d663df108353763a104e6a4e01afc814',
};

describe('authoritative solid brand integration', () => {
  it('keeps the supplied SVG and PNG assets byte-identical', () => {
    for (const [file, expectedHash] of Object.entries(expected)) {
      expect(hash(publicBrand + file), file).toBe(expectedHash);
    }
  });

  it('ships only the selected solid assets in the current public brand directory', () => {
    expect(readdirSync(publicBrand).sort()).toEqual(Object.keys(expected).sort());
  });

  it('uses the supplied wordmark in the shared header and preserves icon and white social assets', () => {
    const app = readFileSync('apps/web/src/App.tsx', 'utf8');
    const header = app.match(/<header className="topbar">([\s\S]*?)<\/header>/)?.[1] ?? '';
    expect(header).toContain('src="/brand/VEREQO_WORDMARK_SOLID.svg"');
    expect(header).not.toMatch(/VEREQO_(?:ICON|LOCKUP)_SOLID/);
    expect(app).toContain('src="/brand/VEREQO_WORDMARK_SOLID.svg"');
    expect(app).not.toMatch(/VEREQO_(?:FIXED_|[^"']*GRADIENT)/);

    const html = readFileSync('apps/web/index.html', 'utf8');
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/brand/VEREQO_ICON_SOLID.svg"');
    expect(html).toContain('rel="apple-touch-icon" href="/brand/VEREQO_ICON_SOLID_4X.png"');
    expect(html).toContain('og:image" content="/brand/VEREQO_LOCKUP_SOLID_WHITE_4X.png"');
    expect(html).toContain('twitter:image" content="/brand/VEREQO_LOCKUP_SOLID_WHITE_4X.png"');
    expect(html).not.toMatch(/VEREQO_(?:FIXED_|[^"']*GRADIENT)/);
  });

  it('uses vector paths without embedded images, live logo text, fonts or filters', () => {
    for (const file of ['VEREQO_LOCKUP_SOLID.svg', 'VEREQO_WORDMARK_SOLID.svg', 'VEREQO_ICON_SOLID.svg']) {
      const svg = readFileSync(publicBrand + file, 'utf8');
      expect(svg).toMatch(/<path\b/);
      expect(svg).not.toMatch(/<(?:image|text|font)\b/i);
      expect(svg).toContain('fill="#0B0D0E"');
    }
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const logoRules = [...css.matchAll(/[^{}]+\{[^{}]*\}/g)]
      .map(match => match[0])
      .filter(rule => rule.includes('.brandLogo') || rule.includes('.brand:hover'));
    expect(logoRules.join('\n')).not.toMatch(/filter\s*:/i);
  });

  it('preserves the source icon raster dimensions for the Apple touch image', () => {
    const icon = readFileSync(publicBrand + 'VEREQO_ICON_SOLID_4X.png');
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(icon.readUInt32BE(16)).toBe(1260);
    expect(icon.readUInt32BE(20)).toBe(1240);
  });
});
