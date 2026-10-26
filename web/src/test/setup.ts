import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Route tests load lazily split route modules, which are transformed on demand (Babel and React
// Compiler included); under parallel test files that can take longer than the 1 s default.
configure({ asyncUtilTimeout: 4000 });

// jsdom implements neither the native <dialog> open/close methods nor window.scrollTo
// (it logs "Not implemented"); behave as open-attribute toggles / a no-op.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close() {
  this.open = false;
};
window.scrollTo = () => undefined;
