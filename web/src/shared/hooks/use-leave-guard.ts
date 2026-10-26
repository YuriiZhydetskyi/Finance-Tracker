import { useCallback } from 'react';
import { useBlocker } from '@tanstack/react-router';

export const UNSAVED_CHANGES_MESSAGE = 'Є незбережені зміни. Вийти без збереження?';

/**
 * Asks for confirmation before the user leaves the page while `active`: in-app
 * navigation, back/forward, and (via beforeunload) closing or reloading the tab.
 * Nothing is registered while inactive.
 *
 * The navigation that completes the guarded work (e.g. to /recent right after a
 * successful save) must pass `ignoreBlocker: true` to `navigate`, because the
 * form still reports itself dirty at that moment.
 */
export function useLeaveGuard(active: boolean, message: string = UNSAVED_CHANGES_MESSAGE): void {
  const shouldBlockFn = useCallback(() => !window.confirm(message), [message]);
  useBlocker({ shouldBlockFn, disabled: !active, enableBeforeUnload: active });
}
