import { useState } from 'react';

export type SelectionOverrides<K> = {
  isSelected: (key: K, defaultChecked: boolean) => boolean;
  toggle: (key: K, defaultChecked: boolean) => void;
  setAll: (keys: K[], checked: boolean) => void;
};

/**
 * Checkbox selection where each row has a data-driven DEFAULT (e.g. pre-checked
 * when the store name matched) and the state stores only explicit user
 * overrides. Unlike a seeded useState Set, this stays correct when rows arrive
 * or re-bucket asynchronously (orphan matches load late; saving an alias
 * re-classifies entries): new rows pick up live defaults, while the user's
 * explicit choices stick.
 */
export function useSelectionOverrides<K>(): SelectionOverrides<K> {
  const [overrides, setOverrides] = useState<ReadonlyMap<K, boolean>>(new Map());

  const isSelected = (key: K, defaultChecked: boolean) => overrides.get(key) ?? defaultChecked;

  const toggle = (key: K, defaultChecked: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, !(prev.get(key) ?? defaultChecked));
      return next;
    });

  const setAll = (keys: K[], checked: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const key of keys) next.set(key, checked);
      return next;
    });

  return { isSelected, toggle, setAll };
}
