import { supabase } from './supabase';
import type { VideoPost, ChatMessage } from './types';

export async function getVideoFeed(limit = 20): Promise<VideoPost[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view your feed.');
  const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
  const followingIds = (follows ?? []).map(row => row.following_id);
  const { data, error } = await supabase.from('videos')
    .select('id,user_id,caption,video_url,thumbnail_url,created_at,profiles(username,avatar_url)')
    .eq('visibility', 'public').order('created_at', { ascending: false }).limit(limit * 3);
  if (error) throw error;
  const posts = (data ?? []) as unknown as VideoPost[];
  // Baseline ranking: followed creators first, then recent public posts.
  return posts.sort((a,b) => Number(followingIds.includes(b.user_id)) - Number(followingIds.includes(a.user_id)))
    .slice(0, limit);
}

export async function sendMessage(conversationId: string, body: string) {
  const text = body.trim();
  if (!text) throw new Error('Message cannot be empty.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const { data, error } = await supabase.from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: text })
    .select().single();
  if (error) throw error;
  return data as ChatMessage;
}

export function subscribeToMessages(conversationId: string, onMessage: (message: ChatMessage) => void) {
  return supabase.channel('messages:' + conversationId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId },
      payload => onMessage(payload.new as ChatMessage))
    .subscribe();
}

export async function createSnap(mediaUrl: string, mediaType: 'image' | 'video', lifetimeHours = 24) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('snaps')
    .insert({ user_id: user.id, media_url: mediaUrl, media_type: mediaType, expires_at: expiresAt })
    .select().single();
  if (error) throw error;
  return data;
}

export async function uploadVideo(uri: string, fileName: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const response = await fetch(uri);
  const blob = await response.blob();
  const path = user.id + '/' + Date.now() + '-' + fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { error } = await supabase.storage.from('videos').upload(path, blob, { contentType: blob.type || 'video/mp4', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('videos').getPublicUrl(path);
  return data.publicUrl;
}
