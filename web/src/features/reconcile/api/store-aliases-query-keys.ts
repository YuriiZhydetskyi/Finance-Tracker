// Cache key for learned statement↔receipt store-name pairs. The save mutation
// invalidates this prefix so a fresh reconcile picks up just-confirmed pairs.
export const storeAliasesQueryKey = ['store-aliases'] as const;
