import { supabase } from './supabase';
import type { ChatMessage } from './types';

const BUCKET = 'chat-attachments';
const SIGNED_URL_SECONDS = 60 * 60;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export async function resolveChatMessageAttachment(message: ChatMessage): Promise<ChatMessage> {
  if (!message.media_url) return { ...message, display_media_url: null };
  if (/^https?:\/\//i.test(message.media_url)) {
    return { ...message, display_media_url: message.media_url };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(message.media_url, SIGNED_URL_SECONDS);
  if (error) {
    console.warn('Could not create a chat attachment URL:', error.message);
    return { ...message, display_media_url: null };
  }
  return { ...message, display_media_url: data.signedUrl };
}

export async function resolveChatMessageAttachments(messages: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(messages.map(resolveChatMessageAttachment));
}

export async function sendChatAttachment(
  conversationId: string,
  uri: string,
  fileName: string | null | undefined,
  contentType: string | null | undefined,
  mediaType: 'image' | 'video',
  reportedFileSize?: number | null,
): Promise<ChatMessage> {
  if (!conversationId || !uri) throw new Error('Choose a conversation and an attachment.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');

  const mime = (contentType || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'))
    .split(';')[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS[mime];
  if (!extension || (mediaType === 'video') !== mime.startsWith('video/')) {
    throw new Error('This image or video format is not supported.');
  }

  const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (reportedFileSize && reportedFileSize > maxBytes) {
    throw new Error(mediaType === 'video'
      ? 'Videos must be 50 MB or smaller.'
      : 'Images must be 15 MB or smaller.');
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the selected attachment from your device.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('The selected attachment is empty.');
  if (blob.size > maxBytes) {
    throw new Error(mediaType === 'video'
      ? 'Videos must be 50 MB or smaller.'
      : 'Images must be 15 MB or smaller.');
  }

  const cleanName = (fileName || 'attachment.' + extension)
    .split(/[\\/]/).pop()!
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-100);
  const uniqueName = Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10) + '-' + cleanName;
  const objectPath = conversationId + '/' + user.id + '/' + uniqueName;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, blob, {
    contentType: mime,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: message, error: insertError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: mediaType === 'image' ? 'Shared a photo' : 'Shared a video',
    media_url: objectPath,
    media_type: mediaType,
  }).select('*').single();

  if (insertError) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([objectPath]);
    if (cleanupError) console.warn('Could not remove an orphaned chat attachment:', cleanupError.message);
    throw insertError;
  }

  return resolveChatMessageAttachment(message as ChatMessage);
}
