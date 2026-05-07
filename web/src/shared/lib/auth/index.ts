// Public export of the auth port. The rest of the app imports `authService`
// only — never `supabaseAuthService` directly. To swap providers, change the
// re-export below to point at a different adapter (e.g. clerk-auth-service).
export type { AuthUser, IAuthService } from './auth.types';
export { supabaseAuthService as authService } from './supabase-auth-service';
