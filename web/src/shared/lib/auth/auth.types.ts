// Auth port — the small interface every adapter must implement. UI depends on
// this interface (via @/shared/lib/dependencies → authService), not on Supabase.
// Swapping to Clerk / Auth0 / Firebase Auth = write a sibling adapter file
// (clerk-auth-service.ts) and change one export line.

export type AuthUser = {
  email: string;
};

export type IAuthService = {
  /** Returns the current signed-in user, or null if not authenticated. */
  getCurrentUser(): Promise<AuthUser | null>;

  /**
   * Subscribe to auth state changes. Callback fires immediately with the
   * current state, then on every sign-in / sign-out / token-refresh.
   * Returns an unsubscribe function.
   */
  onAuthStateChange(cb: (user: AuthUser | null) => void): () => void;

  /** Email-based magic link sign-in. Resolves once the email is sent. */
  signInWithMagicLink(email: string, redirectTo: string): Promise<void>;

  /** Sign out the current session. */
  signOut(): Promise<void>;
};
