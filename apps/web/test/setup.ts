import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Browser APIs jsdom leaves out.
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollTo ??= function () {};
Element.prototype.scrollIntoView ??= function () {};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
