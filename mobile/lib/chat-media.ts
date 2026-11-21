import { supabase } from './supabase';
import { startMediaUpload } from './uploads';
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
  // Only private Storage object paths are rendered. Do not fetch arbitrary remote URLs
  // supplied in a message, which could expose the recipient to untrusted media hosts.
  if (/^https?:\/\//i.test(message.media_url)) {
    return { ...message, display_media_url: null };
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
  onProgress?: (progress: number) => void,
): Promise<ChatMessage> {
  if (!conversationId || !uri) throw new Error('Choose a conversation and an attachment.');
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

  const message = await startMediaUpload({
    uri,
    fileName: fileName || 'attachment.' + extension,
    contentType: mime,
    purpose: 'chat-attachment',
    maxBytes,
    conversationId,
    mediaType,
  }, onProgress) as ChatMessage;

  return resolveChatMessageAttachment(message);
}
