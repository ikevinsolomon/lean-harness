import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { create, slugOf, titleOf } from '../index.mjs';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tmp = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lh-create-'));
  dirs.push(dir);
  return dir;
};

describe('create-lean-harness', () => {
  it('names things from the folder', () => {
    expect(titleOf('support-desk')).toBe('Support Desk');
    expect(slugOf("Kevin's Travel Desk!")).toBe('kevin-s-travel-desk');
  });

  it('copies the template and fills in the name', async () => {
    const dir = join(await tmp(), 'travel-desk');
    const made = await create({ dir, name: "Kevin's Travel Desk" });
    expect(made).toEqual({ name: "Kevin's Travel Desk", slug: 'travel-desk', version: '^0.1.0' });

    for (const file of ['.env.example', '.gitignore', 'instructions.md', 'src/index.ts', 'src/tools.ts', 'knowledge/getting-started.md', 'mcp.json']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('travel-desk');
    expect(pkg.dependencies['@lean-harness/app']).toBe('^0.1.0');
    // Quotes are escaped inside code, and left alone in Markdown.
    expect(await readFile(join(dir, 'src/index.ts'), 'utf8')).toContain("name: 'Kevin\\'s Travel Desk'");
    expect(await readFile(join(dir, 'instructions.md'), 'utf8')).toContain("You are Kevin's Travel Desk");
  });

  it('links the repository packages in workspace mode, and never overwrites a folder', async () => {
    const dir = join(await tmp(), 'ops');
    await create({ dir, workspace: true });
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).dependencies['@lean-harness/core']).toBe('workspace:*');

    const taken = await tmp();
    await writeFile(join(taken, 'keep.txt'), 'mine');
    await expect(create({ dir: taken })).rejects.toThrow(/not empty/);
  });
});
