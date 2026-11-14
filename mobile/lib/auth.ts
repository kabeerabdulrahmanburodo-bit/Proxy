import { supabase } from './supabase';

export async function signUp(email: string, password: string, username: string) {
  const cleanUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) throw new Error('Username must be 3–20 characters (letters, numbers or underscores).');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(), password,
    options: { data: { username: cleanUsername, display_name: cleanUsername } },
  });
  if (error) throw error;
  return data;
}
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  return data;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
