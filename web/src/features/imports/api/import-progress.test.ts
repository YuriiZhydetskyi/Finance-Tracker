import { describe, expect, it } from 'vitest';
import { summarizeImportProgress } from './import-progress';

describe('summarizeImportProgress', () => {
  it('counts every terminal outcome as complete while exposing exceptions separately', () => {
    expect(
      summarizeImportProgress([
        { status: 'saved' },
        { status: 'needs_review' },
        { status: 'duplicate' },
        { status: 'upload_failed' },
        { status: 'discarded' },
        { status: 'uploading' },
        { status: 'queued' },
        { status: 'processing' },
      ]),
    ).toEqual({
      total: 8,
      completed: 5,
      active: 3,
      saved: 1,
      exceptions: 3,
      discarded: 1,
    });
  });

  it('returns a zero progress summary for an empty batch', () => {
    expect(summarizeImportProgress([])).toEqual({
      total: 0,
      completed: 0,
      active: 0,
      saved: 0,
      exceptions: 0,
      discarded: 0,
    });
  });
});
