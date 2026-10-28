#!/usr/bin/env node
// Start a new Lean Harness assistant for a domain: a folder with its instructions, tools,
// knowledge, MCP servers and settings, ready to run.
//
//   npm create lean-harness@latest support-desk -- --name "Support Desk"
//   pnpm new-agent support-desk --name "Support Desk"     (inside the lean-harness repository)
import { existsSync, realpathSync } from 'node:fs';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const VERSION = '^0.1.0';

/** "support-desk" → "Support Desk". */
export const titleOf = (slug) => slug.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
export const slugOf = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Copy the template into `dir`, filling in the assistant's name. `workspace` links the
 * Lean Harness packages from this repository instead of npm.
 */
export async function create({ dir, name, workspace = false }) {
  if (existsSync(dir) && (await readdir(dir)).length) throw new Error(`${dir} already exists and is not empty`);
  const slug = slugOf(basename(dir));
  if (!slug) throw new Error('Give the new assistant a folder name, like support-desk');
  const values = { name: name || titleOf(slug), slug, version: workspace ? 'workspace:*' : VERSION };

  await cp(new URL('./template', import.meta.url), dir, { recursive: true });
  // npm drops dotfiles from published packages, so the template stores them without the dot.
  for (const file of ['gitignore', 'env.example']) await rename(join(dir, `_${file}`), join(dir, `.${file}`));
  for (const file of await files(dir)) {
    const text = await readFile(file, 'utf8');
    if (!text.includes('{{')) continue;
    // Inside code, the name sits in a '...' string: escape quotes and backslashes there.
    const code = /\.(ts|js|mjs)$/.test(file);
    const fill = (m, key) => (key in values ? (code ? values[key].replace(/[\\']/g, '\\$&') : values[key]) : m);
    await writeFile(file, text.replace(/\{\{(\w+)\}\}/g, fill));
  }
  return values;
}

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string', short: 'n' },
      workspace: { type: 'boolean' },
      into: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !positionals[0]) {
    console.log('Usage: create-lean-harness <folder> [--name "Support Desk"]');
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  const dir = resolve(values.into ?? '.', positionals[0]);
  const created = await create({ dir, name: values.name, workspace: values.workspace });
  const where = relative(process.cwd(), dir) || '.';
  console.log(`\nCreated ${created.name} in ${where}\n`);
  if (values.workspace) {
    console.log(`Next:\n  pnpm install\n  cp ${where}/.env.example ${where}/.env      # add a model key\n  pnpm --filter ${created.slug} dev\n`);
  } else {
    console.log(`Next:\n  cd ${where}\n  npm install\n  cp .env.example .env      # add a model key\n  npm run dev\n`);
  }
  console.log('Then open http://localhost:8787. Make it yours: instructions.md, src/tools.ts, knowledge/.');
}

// Run as a command (also through npm's bin link), not when imported.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
