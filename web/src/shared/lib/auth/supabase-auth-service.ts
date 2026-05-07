import { supabase } from '../supabase-client';
import type { AuthUser, IAuthService } from './auth.types';

function fromSupabaseUser(email: string | null | undefined): AuthUser | null {
  return email ? { email } : null;
}

export const supabaseAuthService: IAuthService = {
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return fromSupabaseUser(data.user?.email);
  },

  onAuthStateChange(cb) {
    // Fire once with initial state — convention many UIs depend on.
    void supabase.auth.getUser().then(({ data }) => {
      cb(fromSupabaseUser(data.user?.email));
    });

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
