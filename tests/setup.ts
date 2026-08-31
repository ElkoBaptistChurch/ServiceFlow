import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement scrollIntoView; ContentPane calls it to reveal a
// content-search match. Stub it so that code path is exercisable under jsdom.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement PromiseRejectionEvent; App.test.tsx constructs one directly to
// simulate an unhandled rejection reaching App's global error-banner listener.
if (typeof (globalThis as any).PromiseRejectionEvent === 'undefined') {
  class PromiseRejectionEventPolyfill extends Event {
    promise: Promise<unknown>;
    reason: unknown;
    constructor(type: string, init: EventInit & { promise: Promise<unknown>; reason: unknown }) {
      super(type, init);
      this.promise = init.promise;
      this.reason = init.reason;
    }
  }
  (globalThis as any).PromiseRejectionEvent = PromiseRejectionEventPolyfill;
}

afterEach(() => {
  cleanup();
});
