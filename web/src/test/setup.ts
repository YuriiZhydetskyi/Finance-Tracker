import '@testing-library/jest-dom/vitest';

// jsdom implements neither the native <dialog> open/close methods nor window.scrollTo
// (it logs "Not implemented"); behave as open-attribute toggles / a no-op.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close() {
  this.open = false;
};
window.scrollTo = () => undefined;
