import { supabase } from './supabase';
import type { VideoPost, ChatMessage } from './types';

export async function getVideoFeed(limit = 20): Promise<VideoPost[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view your feed.');
  const { data: follows, error: followsError } = await supabase
    .from('follows').select('following_id').eq('follower_id', user.id);
  if (followsError) throw followsError;
  const followingIds = (follows ?? []).map(row => row.following_id);
  const { data, error } = await supabase.from('videos')
    .select('id,user_id,caption,video_url,thumbnail_url,created_at,profiles(username,avatar_url)')
    .in('visibility', ['public', 'followers'])
    .order('created_at', { ascending: false }).limit(limit * 3);
  if (error) throw error;
  const posts = (data ?? []) as unknown as VideoPost[];
  // RLS filters follower-only posts; this baseline ranking prioritizes followed creators.
  return posts.sort((a, b) =>
    Number(followingIds.includes(b.user_id)) - Number(followingIds.includes(a.user_id))
  ).slice(0, limit);
}

export async function publishVideo(uri: string, fileName: string, contentType: string, caption: string) {
  const text = caption.trim();
  if (text.length > 2200) throw new Error('Caption must be 2,200 characters or fewer.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the selected video from your device.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('The selected video is empty.');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = user.id + '/' + Date.now() + '-' + (safeName || 'upload.mp4');
  const mime = contentType || blob.type || 'video/mp4';

  const { error: uploadError } = await supabase.storage.from('videos').upload(path, blob, {
    contentType: mime, upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from('videos').getPublicUrl(path);
  const { data: post, error: insertError } = await supabase.from('videos').insert({
    user_id: user.id,
    caption: text || null,
    video_url: publicData.publicUrl,
    visibility: 'public',
  }).select('id,user_id,caption,video_url,thumbnail_url,created_at').single();

  if (insertError) {
    // Avoid leaving an orphaned public upload if its database row cannot be created.
    await supabase.storage.from('videos').remove([path]);
    throw insertError;
  }
  return post as VideoPost;
}

export async function recordVideoView(videoId: string, watchSeconds: number, completed = false) {
  const seconds = Math.max(0, Math.floor(watchSeconds));
  if (seconds === 0 && !completed) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('video_views').insert({
    video_id: videoId, user_id: user.id, watch_seconds: seconds, completed,
  });
  if (error) console.warn('Could not record video view:', error.message);
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
