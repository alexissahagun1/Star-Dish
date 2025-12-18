import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// For MVP: configure via app config / env.
// In Expo, you can use EXPO_PUBLIC_* env vars.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail fast in dev so misconfig is obvious.
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

// Supabase Edge Functions require a JWT bearer token in the Authorization header.
// The "sb_publishable_*" keys are NOT JWTs and will cause 401 Invalid JWT / Missing authorization header.
// For Expo clients, you should use the Project API key labeled "anon" (it typically starts with "eyJ...").
if (anonKey.startsWith('sb_publishable_')) {
  throw new Error(
    'Invalid Supabase key type for this app. EXPO_PUBLIC_SUPABASE_ANON_KEY is set to a publishable key (sb_publishable_*), but Edge Functions require the anon JWT key (usually starts with "eyJ..."). Update your env var to the Project API key labeled "anon" in the Supabase dashboard.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Required for React Native to persist sessions between reloads.
    storage: AsyncStorage,
    // Email/password does not require PKCE or URL-based session detection.
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});



