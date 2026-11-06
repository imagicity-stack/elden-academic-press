import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// On Vercel the server runs as plain ES modules: a relative import without its ".js"
// extension works in tests and in the dev server, but crashes every API route in production.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) ? [p] : [];
});

describe('server imports', () => {
  it('give every relative import its .js extension (server, api and src/shared)', () => {
    const bad: string[] = [];
    for (const f of [...files('server'), ...files('api'), ...files('src/shared')]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        if (!m[1].endsWith('.js')) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
