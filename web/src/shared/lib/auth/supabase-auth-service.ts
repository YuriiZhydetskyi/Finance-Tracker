import { supabase } from '../supabase-client';
import type { AuthUser, IAuthService } from './auth.types';

function fromSupabaseUser(email: string | null | undefined): AuthUser | null {
  return email ? { email } : null;
}

export const supabaseAuthService: IAuthService = {
  // Read from the locally stored session (refreshed when expired) rather than
  // `auth.getUser()`, which costs a /auth/v1/user request per call. Authorization
  // never depends on this value: RLS checks the JWT on every request.
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return fromSupabaseUser(data.session?.user.email);
  },

  onAuthStateChange(cb) {
    // supabase-js replays the stored session to every new subscriber as an
    // INITIAL_SESSION event, which is how this fires "immediately" with the current
    // state — no extra request needed.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(fromSupabaseUser(session?.user.email));
    });
    return () => {
      data.subscription.unsubscribe();
    };
  },

  async signInWithMagicLink(email, redirectTo) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};
