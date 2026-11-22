import { supabase } from './supabase';
import { startMediaUpload } from './uploads';
import type {
  ChatMessage, ConversationDetails, ConversationPresence, ConversationSummary, MessageReadReceipt,
  BlockedUser, Snap, SnapStory, SnapStoryGroup, UserSearchResult, VideoPost, VideoReportReason,
} from './types';

export const MESSAGE_PAGE_SIZE = 30;

const VIDEO_SIGNED_URL_TTL_SECONDS = 5 * 60;

function getVideoObjectPath(videoUrl: string, ownerId: string): string | null {
  let path = videoUrl.trim();
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!configuredUrl) return null;
    try {
      const projectUrl = new URL(configuredUrl);
      const legacyUrl = new URL(path);
      const publicVideosPrefix = '/storage/v1/object/public/videos/';
      if (
        legacyUrl.origin !== projectUrl.origin ||
        legacyUrl.search ||
        legacyUrl.hash ||
        !legacyUrl.pathname.startsWith(publicVideosPrefix)
      ) return null;
      path = decodeURIComponent(legacyUrl.pathname.slice(publicVideosPrefix.length));
    } catch {
      return null;
    }
  }

  const parts = path.split('/');
  if (
    parts.length !== 2 ||
    parts[0] !== ownerId ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(parts[1])
  ) return null;
  return path;
}

export async function getVideoPlaybackUrl(
  post: Pick<VideoPost, 'video_url' | 'user_id'>,
): Promise<string> {
  const objectPath = getVideoObjectPath(post.video_url, post.user_id);
  if (!objectPath) {
    throw new Error('This video does not have a valid owner-scoped Storage path. Ask the creator to re-upload it for secure playback.');
  }
  const { data, error } = await supabase.storage
    .from('videos')
    .createSignedUrl(objectPath, VIDEO_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not create a secure video playback URL.');
  return data.signedUrl;
}

export async function getVideoFeed(limit = 20): Promise<VideoPost[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view your feed.');
  const requestedLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));

  const { data: ranked, error: rankingError } = await supabase.rpc(
    'get_personalized_video_feed',
    { p_limit: requestedLimit },
  );
  if (!rankingError) {
    return ((ranked ?? []) as Array<{
      id: string;
      user_id: string;
      caption: string | null;
      video_url: string;
      thumbnail_url: string | null;
      created_at: string;
      username: string | null;
      avatar_url: string | null;
    }>).map(row => ({
      id: row.id,
      user_id: row.user_id,
      caption: row.caption,
      video_url: row.video_url,
      thumbnail_url: row.thumbnail_url,
      created_at: row.created_at,
      profiles: { username: row.username ?? 'creator', avatar_url: row.avatar_url },
    }));
  }

  // Keep the safe, RLS-filtered chronological feed available if migration 0013
  // has not been applied yet. Only fall back for a missing RPC, not other errors.
  if (rankingError.code !== 'PGRST202' && rankingError.code !== '42883') {
    throw rankingError;
  }
  const { data: follows, error: followsError } = await supabase
    .from('follows').select('following_id').eq('follower_id', user.id);
  if (followsError) throw followsError;
  const followingIds = (follows ?? []).map(row => row.following_id);
  const { data, error } = await supabase.from('videos')
    .select('id,user_id,caption,video_url,thumbnail_url,created_at,profiles(username,avatar_url)')
    .in('visibility', ['public', 'followers'])
    .order('created_at', { ascending: false }).limit(requestedLimit * 3);
  if (error) throw error;
  const posts = (data ?? []) as unknown as VideoPost[];
  return posts.sort((a, b) =>
    Number(followingIds.includes(b.user_id)) - Number(followingIds.includes(a.user_id))
  ).slice(0, requestedLimit);
}

export async function publishVideo(
  uri: string,
  fileName: string,
  contentType: string,
  caption: string,
  onProgress?: (progress: number) => void,
): Promise<VideoPost> {
  return await startMediaUpload({
    uri,
    fileName,
    contentType,
    purpose: 'video-post',
    maxBytes: 500 * 1024 * 1024,
    caption: caption.trim(),
  }, onProgress) as VideoPost;
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

export async function blockUser(userId: string): Promise<void> {
  if (!userId) throw new Error('Choose an account to block.');
  const { data, error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) throw error;
  if (data !== true) throw new Error('The account could not be blocked.');
}

export async function unblockUser(userId: string): Promise<void> {
  if (!userId) throw new Error('Choose an account to unblock.');
  const { data, error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  if (error) throw error;
  if (data !== true) throw new Error('This account is no longer in your blocked list.');
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to manage blocked accounts.');

  const { data: blocks, error } = await supabase.from('user_blocks')
    .select('blocked_id,created_at')
    .eq('blocker_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = blocks ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map(row => row.blocked_id);
  const { data: profiles, error: profilesError } = await supabase.from('profiles')
    .select('id,username,display_name,avatar_url')
    .in('id', ids);
  if (profilesError) throw profilesError;
  const profilesById = new Map(
    ((profiles ?? []) as UserSearchResult[]).map(profile => [profile.id, profile] as const)
  );
  return rows.map(row => ({
    blocked_id: row.blocked_id,
    created_at: row.created_at,
    profile: profilesById.get(row.blocked_id) ?? null,
  }));
}

export async function reportVideo(
  videoId: string,
  reason: VideoReportReason,
  details?: string,
): Promise<string> {
  if (!videoId) throw new Error('Choose a video to report.');
  const cleanDetails = details?.trim() ?? '';
  if (cleanDetails.length > 500) throw new Error('Report details must be 500 characters or fewer.');
  const { data, error } = await supabase.rpc('report_video', {
    p_video_id: videoId,
    p_reason: reason,
    p_details: cleanDetails || null,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('Your report could not be recorded.');
  return data;
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to search for people.');
  const term = query.trim().replace(/[^a-zA-Z0-9_ -]/g, '').slice(0, 32);
  if (term.length < 2) return [];
  const pattern = '%' + term + '%';
  const { data, error } = await supabase.from('profiles')
    .select('id,username,display_name,avatar_url')
    .neq('id', user.id)
    .or('username.ilike.' + pattern + ',display_name.ilike.' + pattern)
    .order('username', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as UserSearchResult[];
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view your chats.');

  const { data: memberships, error: membershipError } = await supabase
    .from('conversation_members').select('conversation_id').eq('user_id', user.id);
  if (membershipError) throw membershipError;
  const conversationIds = [...new Set((memberships ?? []).map(row => row.conversation_id))];
  if (conversationIds.length === 0) return [];

  const [conversationResult, memberResult, messageResult] = await Promise.all([
    supabase.from('conversations').select('id,is_group,title,created_at')
      .in('id', conversationIds).order('created_at', { ascending: false }),
    supabase.from('conversation_members').select('conversation_id,user_id')
      .in('conversation_id', conversationIds),
    supabase.from('messages').select('conversation_id,sender_id,body,created_at')
      .in('conversation_id', conversationIds).order('created_at', { ascending: false }).limit(200),
  ]);
  if (conversationResult.error) throw conversationResult.error;
  if (memberResult.error) throw memberResult.error;
  if (messageResult.error) throw messageResult.error;

  const memberRows = (memberResult.data ?? []) as Array<{ conversation_id: string; user_id: string }>;
  const otherUserIds = [...new Set(memberRows.filter(row => row.user_id !== user.id).map(row => row.user_id))];
  const profileResult = otherUserIds.length
    ? await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', otherUserIds)
    : { data: [], error: null };
  if (profileResult.error) throw profileResult.error;

  const profilesById = new Map<string, UserSearchResult>(
    ((profileResult.data ?? []) as UserSearchResult[]).map(profile => [profile.id, profile] as const)
  );
  const otherUserByConversation = new Map<string, UserSearchResult>();
  memberRows.forEach(row => {
    if (row.user_id !== user.id) {
      const profile = profilesById.get(row.user_id);
      if (profile && !otherUserByConversation.has(row.conversation_id)) {
        otherUserByConversation.set(row.conversation_id, profile);
      }
    }
  });
  const lastMessageByConversation = new Map<string, ConversationSummary['last_message']>();
  (messageResult.data ?? []).forEach(message => {
    if (!lastMessageByConversation.has(message.conversation_id)) {
      lastMessageByConversation.set(message.conversation_id, {
        body: message.body, created_at: message.created_at, sender_id: message.sender_id,
      });
    }
  });

  return (conversationResult.data ?? []).map(conversation => ({
    ...conversation,
    other_user: otherUserByConversation.get(conversation.id) ?? null,
    last_message: lastMessageByConversation.get(conversation.id) ?? null,
  })) as ConversationSummary[];
}

export async function getConversationDetails(conversationId: string): Promise<ConversationDetails> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to open this chat.');
  const { data: conversation, error } = await supabase.from('conversations')
    .select('id,is_group,title,created_by').eq('id', conversationId).single();
  if (error) throw error;

  const { data: memberRows, error: membersError } = await supabase.from('conversation_members')
    .select('user_id').eq('conversation_id', conversationId);
  if (membersError) throw membersError;
  const memberIds = [...new Set((memberRows ?? []).map(row => row.user_id))];
  const profileResult = memberIds.length
    ? await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', memberIds)
    : { data: [], error: null };
  if (profileResult.error) throw profileResult.error;

  const members = (profileResult.data ?? []) as UserSearchResult[];
  const otherUser = members.find(member => member.id !== user.id) ?? null;
  const title = conversation.is_group
    ? (conversation.title || 'Group chat')
    : (otherUser?.display_name || (otherUser ? '@' + otherUser.username : 'Direct message'));
  return {
    ...conversation,
    title,
    other_user: otherUser,
    members,
    is_creator: conversation.created_by === user.id,
  } as ConversationDetails;
}

export async function getConversationMessages(
  conversationId: string,
  before?: Pick<ChatMessage, 'id' | 'created_at'>,
  pageSize = MESSAGE_PAGE_SIZE,
): Promise<ChatMessage[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(pageSize)));
  let query = supabase.from('messages').select('*').eq('conversation_id', conversationId);
  if (before) {
    query = query.or(
      'created_at.lt.' + before.created_at +
      ',and(created_at.eq.' + before.created_at + ',id.lt.' + before.id + ')'
    );
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function getMessageReadReceipts(messageIds: string[]): Promise<MessageReadReceipt[]> {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('message_reads')
    .select('message_id,user_id,read_at').in('message_id', ids);
  if (error) throw error;
  return (data ?? []) as MessageReadReceipt[];
}

export async function markConversationMessagesRead(conversationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('mark_conversation_messages_read', {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
  if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
    throw new Error('The read receipt update returned an invalid result.');
  }
  return data;
}

export async function createDirectConversation(otherUserId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  if (otherUserId === user.id) throw new Error('You cannot start a chat with yourself.');
  const { data, error } = await supabase.rpc('create_direct_conversation', { other_user_id: otherUserId });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('The chat could not be created.');
  return data;
}

export async function createGroupConversation(title: string, memberIds: string[]): Promise<string> {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 60) {
    throw new Error('Group name must be between 1 and 60 characters.');
  }
  const uniqueIds = [...new Set(memberIds.filter(Boolean))];
  if (uniqueIds.length < 2) throw new Error('Choose at least two other people for a group.');
  if (uniqueIds.length > 49) throw new Error('A group can have at most 50 members, including you.');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const { data, error } = await supabase.rpc('create_group_conversation', {
    group_title: cleanTitle,
    member_ids: uniqueIds,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('The group could not be created.');
  return data;
}

export async function addGroupConversationMembers(conversationId: string, memberIds: string[]): Promise<number> {
  const uniqueIds = [...new Set(memberIds.filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error('Choose at least one person to add.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const { data, error } = await supabase.rpc('add_group_conversation_members', {
    target_conversation_id: conversationId,
    member_ids: uniqueIds,
  });
  if (error) throw error;
  if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
    throw new Error('The group membership update returned an invalid result.');
  }
  return data;
}

export async function removeGroupConversationMember(
  conversationId: string,
  memberId: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  if (!conversationId || !memberId) throw new Error('A group and member are required.');

  const { data, error } = await supabase.rpc('remove_group_conversation_member', {
    target_conversation_id: conversationId,
    target_member_id: memberId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('The group membership change was not confirmed.');
}

export async function transferGroupConversationOwnership(
  conversationId: string,
  newOwnerId: string,
): Promise<void> {
  if (!conversationId || !newOwnerId) throw new Error('A group and new creator are required.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  if (newOwnerId === user.id) throw new Error('Choose another group member.');

  const { data, error } = await supabase.rpc('transfer_group_conversation_ownership', {
    target_conversation_id: conversationId,
    new_owner_id: newOwnerId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('The group ownership transfer was not confirmed.');
}

export async function leaveGroupConversation(conversationId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  await removeGroupConversationMember(conversationId, user.id);
}

export async function canSendConversationMessage(conversationId: string): Promise<boolean> {
  if (!conversationId) return false;
  const { data, error } = await supabase.rpc('can_send_conversation_message', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return data === true;
}

export async function sendMessage(conversationId: string, body: string) {
  const text = body.trim();
  if (!text) throw new Error('Message cannot be empty.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  if (!(await canSendConversationMessage(conversationId))) {
    throw new Error('Direct messaging is unavailable while a block is active.');
  }
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

export function subscribeToMessageReadReceipts(
  conversationId: string,
  onReceipt: (receipt: MessageReadReceipt) => void,
) {
  // RLS limits visible rows to receipts owned by this user or receipts on their own messages.
  return supabase.channel('message-reads:' + conversationId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads' },
      payload => onReceipt(payload.new as MessageReadReceipt))
    .subscribe();
}

export function subscribeToConversationPresence(
  conversationId: string,
  userId: string,
  onPresence: (presence: ConversationPresence[]) => void,
) {
  const channel = supabase.channel('proxy-chat:' + conversationId, {
    config: { private: true, presence: { key: userId } },
  });

  const publishPresence = () => {
    const entries: ConversationPresence[] = [];
    Object.values(channel.presenceState<ConversationPresence>()).forEach(values => entries.push(...values));
    const byUser = new Map<string, ConversationPresence>();
    entries.forEach(entry => {
      if (!entry.user_id) return;
      const previous = byUser.get(entry.user_id);
      byUser.set(entry.user_id, {
        user_id: entry.user_id,
        online: Boolean(entry.online || previous?.online),
        typing: Boolean(entry.typing || previous?.typing),
      });
    });
    onPresence([...byUser.values()]);
  };

  channel
    .on('presence', { event: 'sync' }, publishPresence)
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        const result = await channel.track({ user_id: userId, online: true, typing: false });
        if (result !== 'ok') console.warn('Could not publish chat presence:', result);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Chat presence channel unavailable:', status);
      }
    });

  return channel;
}

export async function trackConversationTyping(
  channel: ReturnType<typeof supabase.channel>,
  userId: string,
  typing: boolean,
) {
  const result = await channel.track({ user_id: userId, online: true, typing });
  if (result !== 'ok') console.warn('Could not update typing status:', result);
}

export async function trackConversationOnline(
  channel: ReturnType<typeof supabase.channel>,
  userId: string,
  online: boolean,
) {
  const result = await channel.track({ user_id: userId, online, typing: false });
  if (result !== 'ok') console.warn('Could not update online status:', result);
}

export async function createSnap(mediaPath: string, mediaType: 'image' | 'video', lifetimeHours = 24) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  if (!Number.isFinite(lifetimeHours) || lifetimeHours <= 0 || lifetimeHours > 24) {
    throw new Error('Snaps can remain active for up to 24 hours.');
  }
  const pathParts = mediaPath.split('/');
  if ((mediaPath.startsWith('http://') || mediaPath.startsWith('https://')) || pathParts.length !== 2 ||
      pathParts[0] !== user.id || !pathParts[1]) {
    throw new Error('Snap media must be uploaded to your own private Storage folder.');
  }

  const existing = await supabase.from('snaps').select('*')
    .eq('user_id', user.id).eq('media_url', mediaPath).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('snaps')
    .insert({ user_id: user.id, media_url: mediaPath, media_type: mediaType, expires_at: expiresAt })
    .select().single();
  if (error) throw error;
  return data;
}


export async function getActiveSnapStories(): Promise<SnapStoryGroup[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view Snaps.');

  const { data, error } = await supabase.from('snaps')
    .select('id,user_id,media_url,media_type,caption,expires_at,created_at,profiles(username,display_name,avatar_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const groups = new Map<string, SnapStoryGroup>();
  ((data ?? []) as unknown as SnapStory[]).forEach(snap => {
    const profile = snap.profiles;
    const group = groups.get(snap.user_id) ?? {
      user_id: snap.user_id,
      username: profile?.username ?? 'proxy_user',
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      is_own: snap.user_id === user.id,
      snaps: [],
    };
    group.snaps.push(snap);
    groups.set(snap.user_id, group);
  });

  groups.forEach(group => group.snaps.reverse());
  return [...groups.values()].sort((a, b) => {
    if (a.is_own) return -1;
    if (b.is_own) return 1;
    const aLatest = Date.parse(a.snaps[a.snaps.length - 1]?.created_at ?? '');
    const bLatest = Date.parse(b.snaps[b.snaps.length - 1]?.created_at ?? '');
    return bLatest - aLatest;
  });
}

export async function getActiveSnapsForUser(userId: string): Promise<SnapStory[]> {
  if (!userId) throw new Error('A Snap creator is required.');
  const { data, error } = await supabase.from('snaps')
    .select('id,user_id,media_url,media_type,caption,expires_at,created_at,profiles(username,display_name,avatar_url)')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as SnapStory[]).reverse();
}

export async function resolveSnapMediaUrl(snap: Snap): Promise<string> {
  if (Date.parse(snap.expires_at) <= Date.now()) {
    throw new Error('This Snap has expired.');
  }

  const mediaPath = snap.media_url.trim();
  if (mediaPath.startsWith('https://')) {
    let mediaUrl: URL;
    let projectUrl: URL;
    try {
      mediaUrl = new URL(mediaPath);
      projectUrl = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
    } catch {
      throw new Error('This Snap has an invalid media link.');
    }
    if (
      mediaUrl.origin !== projectUrl.origin ||
      !mediaUrl.pathname.startsWith('/storage/v1/object/sign/snaps/')
    ) {
      throw new Error('This Snap does not point to an approved private media object.');
    }
    return mediaPath;
  }

  const parts = mediaPath.split('/');
  if (
    parts.length !== 2 ||
    parts[0] !== snap.user_id ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/.test(parts[1]) ||
    parts[1] === '.' ||
    parts[1] === '..'
  ) {
    throw new Error('This Snap has an invalid private Storage path.');
  }

  const { data, error } = await supabase.storage.from('snaps').createSignedUrl(mediaPath, 300);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('A temporary Snap viewing link could not be created.');
  return data.signedUrl;
}

export async function recordSnapView(snapId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view Snaps.');

  const { data: snap, error: snapError } = await supabase.from('snaps')
    .select('id,user_id')
    .eq('id', snapId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (snapError) throw snapError;
  if (!snap) throw new Error('This Snap is unavailable or has expired.');
  if (snap.user_id === user.id) return;

  const { error } = await supabase.from('snap_views').insert({
    snap_id: snapId,
    viewer_id: user.id,
  });
  // A viewer is recorded once per Snap; revisiting must not create duplicate views.
  if (error && error.code !== '23505') throw error;
}

export async function getSnapViewCount(snapId: string): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to view Snap insights.');

  const { data: snap, error: snapError } = await supabase.from('snaps')
    .select('user_id')
    .eq('id', snapId)
    .maybeSingle();
  if (snapError) throw snapError;
  if (!snap || snap.user_id !== user.id) {
    throw new Error('Only the Snap owner can view its audience count.');
  }

  const { count, error } = await supabase.from('snap_views')
    .select('viewer_id', { count: 'exact', head: true })
    .eq('snap_id', snapId);
  if (error) throw error;
  return count ?? 0;
}
