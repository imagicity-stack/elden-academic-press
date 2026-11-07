import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The DoomsDay Diaries story brief (and the comic's title) is shown only to approved teams,
// from the server. Anything in src/ or public/ ships to every visitor's browser, so it must
// never appear there.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html|json|txt|md)$/.test(f) ? [p] : [];
});

describe('the website code', () => {
  it('does not contain the secret story brief', () => {
    const leaks = [...files('src'), ...files('public'), 'index.html'].filter((f) => /Wrong\s*Town|WrongTown/i.test(readFileSync(f, 'utf8')));
    expect(leaks).toEqual([]);
  });
});
