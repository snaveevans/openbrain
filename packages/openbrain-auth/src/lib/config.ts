declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

export function getSupabaseUrl(): string {
  return __SUPABASE_URL__;
}

export function getSupabasePublishableKey(): string {
  return __SUPABASE_PUBLISHABLE_KEY__;
}
