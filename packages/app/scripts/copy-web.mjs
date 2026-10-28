// Bundle the built web app into this package, so `startApp` can serve it from npm.
import { cp, rm } from 'node:fs/promises';

const from = new URL('../../../apps/web/dist/', import.meta.url);
const to = new URL('../web/', import.meta.url);
await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true, filter: (src) => !src.endsWith('.map') });
console.log('Copied the web app into packages/app/web');
