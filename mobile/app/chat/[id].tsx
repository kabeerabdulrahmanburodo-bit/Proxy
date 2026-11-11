import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
  Text, TextInput, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getConversationDetails, getConversationMessages, getMessageReadReceipts, markConversationMessagesRead,
  MESSAGE_PAGE_SIZE, sendMessage, subscribeToConversationPresence, subscribeToMessages,
  subscribeToMessageReadReceipts, trackConversationOnline, trackConversationTyping,
} from '../../lib/social';
import { resolveChatMessageAttachment, resolveChatMessageAttachments, sendChatAttachment } from '../../lib/chat-media';
import { supabase } from '../../lib/supabase';
import type { ChatMessage, ConversationDetails, ConversationPresence, MessageReadReceipt } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';

function ChatVideoAttachment({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => { instance.loop = false; });
  return <VideoView
    player={player}
    style={{ width: 236, height: 300, borderRadius: 12, overflow: 'hidden' }}
    nativeControls
    contentFit="contain"
  />;
}

function ChatAttachment({ uri, mediaType }: { uri: string; mediaType: 'image' | 'video' | null }) {
  if (mediaType === 'video') return <ChatVideoAttachment uri={uri} />;
  return <Image
    source={{ uri }}
    style={{ width: 236, height: 236, borderRadius: 12, backgroundColor: '#09090b' }}
    resizeMode="cover"
  />;
}

function mergeReceipts(
  current: Record<string, string[]>,
  receipts: MessageReadReceipt[],
  currentUserId: string,
) {
  const next = { ...current };
  receipts.forEach(receipt => {
    if (receipt.user_id === currentUserId) return;
    const readers = next[receipt.message_id] ?? [];
    if (!readers.includes(receipt.user_id)) {
      next[receipt.message_id] = [...readers, receipt.user_id];
    }
  });
  return next;
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const [details, setDetails] = useState<ConversationDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readersByMessage, setReadersByMessage] = useState<Record<string, string[]>>({});
  const [presence, setPresence] = useState<ConversationPresence[]>([]);
  const [presenceReady, setPresenceReady] = useState(false);
  const [userId, setUserId] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const userIdRef = useRef('');
  const ownMessageIdsRef = useRef(new Set<string>());
  const nearBottomRef = useRef(true);
  const scrollToBottomRef = useRef(false);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null;
    setPresence([]);
    setPresenceReady(false);

    const messageChannel = subscribeToMessages(id, incoming => {
      void resolveChatMessageAttachment(incoming).then(resolved => {
        if (!active) return;
        const mine = resolved.sender_id === userIdRef.current;
        if (mine) ownMessageIdsRef.current.add(resolved.id);
        scrollToBottomRef.current = nearBottomRef.current || mine;
        setMessages(old => {
          const byId = new Map(old.map(message => [message.id, message]));
          byId.set(resolved.id, resolved);
          return [...byId.values()].sort((a, b) =>
            a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
          );
        });
        if (!mine && AppState.currentState === 'active') {
          void markConversationMessagesRead(id).catch(error =>
            console.warn('Could not mark chat messages as read:', error)
          );
        }
      });
    });
    const receiptChannel = subscribeToMessageReadReceipts(id, receipt => {
      if (!ownMessageIdsRef.current.has(receipt.message_id)) return;
      setReadersByMessage(old => mergeReceipts(old, [receipt], userIdRef.current));
    });
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const channel = presenceChannelRef.current;
      const currentUserId = userIdRef.current;
      if (nextState === 'active') {
        void markConversationMessagesRead(id).catch(error =>
          console.warn('Could not mark chat messages as read:', error)
        );
        if (channel && currentUserId) {
          void trackConversationOnline(channel, currentUserId, true);
        }
      } else {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        isTypingRef.current = false;
        if (channel && currentUserId) {
          void trackConversationOnline(channel, currentUserId, false);
        }
      }
    });

    void (async () => {
      try {
        const [conversation, rawHistory, auth] = await Promise.all([
          getConversationDetails(id),
          getConversationMessages(id),
          supabase.auth.getUser(),
        ]);
        if (!active) return;
        const history = await resolveChatMessageAttachments(rawHistory);
        if (!active) return;
        const currentUserId = auth.data.user?.id ?? '';
        userIdRef.current = currentUserId;
        setUserId(currentUserId);
        setDetails(conversation);
        ownMessageIdsRef.current = new Set(
          history.filter(message => message.sender_id === currentUserId).map(message => message.id)
        );
        setMessages(old => {
          const byId = new Map(history.map(message => [message.id, message]));
          old.forEach(message => byId.set(message.id, message));
          return [...byId.values()].sort((a, b) =>
            a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
          );
        });
        setHasMoreMessages(rawHistory.length === MESSAGE_PAGE_SIZE);
        scrollToBottomRef.current = true;

        if (currentUserId) {
          presenceChannel = subscribeToConversationPresence(id, currentUserId, users => {
            if (active) {
              setPresence(users);
              setPresenceReady(true);
            }
          });
          presenceChannelRef.current = presenceChannel;
        }

        try {
          const receipts = await getMessageReadReceipts(rawHistory.map(message => message.id));
          if (active) setReadersByMessage(old => mergeReceipts(old, receipts, currentUserId));
        } catch (error) {
          console.warn('Read receipts are unavailable until migration 0004 is applied:', error);
        }
        if (active && AppState.currentState === 'active') {
          try {
            await markConversationMessagesRead(id);
          } catch (error) {
            console.warn('Read receipts are unavailable until migration 0004 is applied:', error);
          }
        }
      } catch (error) {
        if (active) Alert.alert('Conversation', error instanceof Error ? error.message : 'Could not load this chat.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      isTypingRef.current = false;
      if (presenceChannelRef.current === presenceChannel) presenceChannelRef.current = null;
      appStateSubscription.remove();
      void supabase.removeChannel(messageChannel);
      void supabase.removeChannel(receiptChannel);
      if (presenceChannel) void supabase.removeChannel(presenceChannel);
    };
  }, [id]);

  function stopTyping() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    if (!isTypingRef.current) return;
    isTypingRef.current = false;
    const channel = presenceChannelRef.current;
    if (channel && userIdRef.current) {
      void trackConversationTyping(channel, userIdRef.current, false);
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    const channel = presenceChannelRef.current;
    const currentUserId = userIdRef.current;
    if (!channel || !currentUserId) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (value.trim()) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        void trackConversationTyping(channel, currentUserId, true);
      }
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
        if (isTypingRef.current) {
          isTypingRef.current = false;
          const activeChannel = presenceChannelRef.current;
          if (activeChannel) void trackConversationTyping(activeChannel, currentUserId, false);
        }
      }, 1600);
    } else {
      stopTyping();
    }
  }

  async function loadOlderMessages() {
    const oldest = messages[0];
    if (!id || !oldest || !hasMoreMessages || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await getConversationMessages(id, { id: oldest.id, created_at: oldest.created_at });
      if (older.length < MESSAGE_PAGE_SIZE) setHasMoreMessages(false);
      older.forEach(message => {
        if (message.sender_id === userIdRef.current) ownMessageIdsRef.current.add(message.id);
      });
      const resolvedOlder = await resolveChatMessageAttachments(older);
      setMessages(current => {
        const byId = new Map(resolvedOlder.map(message => [message.id, message]));
        current.forEach(message => byId.set(message.id, message));
        return [...byId.values()].sort((a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
        );
      });
      const receipts = await getMessageReadReceipts(older.map(message => message.id));
      setReadersByMessage(current => mergeReceipts(current, receipts, userIdRef.current));
    } catch (error) {
      Alert.alert('Messages', error instanceof Error ? error.message : 'Could not load earlier messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function submit() {
    if (!id || !draft.trim() || sending) return;
    stopTyping();
    setSending(true);
    try {
      const created = await sendMessage(id, draft);
      ownMessageIdsRef.current.add(created.id);
      scrollToBottomRef.current = true;
      setMessages(old => old.some(message => message.id === created.id) ? old : [...old, created]);
      setDraft('');
    } catch (error) {
      Alert.alert('Message', error instanceof Error ? error.message : 'Unable to send your message.');
    } finally {
      setSending(false);
    }
  }

  async function pickAttachment() {
    if (!id || sending) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access', 'Allow photo library access to share an image or video.');
      return;
    }

    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 0.85,
      videoMaxDuration: 180,
    });
    if (selection.canceled || !selection.assets[0]) return;

    const asset = selection.assets[0];
    const mediaType: 'image' | 'video' =
      asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'video' : 'image';

    setSending(true);
    stopTyping();
    try {
      const created = await sendChatAttachment(
        id,
        asset.uri,
        asset.fileName,
        asset.mimeType,
        mediaType,
        asset.fileSize,
      );
      ownMessageIdsRef.current.add(created.id);
      scrollToBottomRef.current = true;
      setMessages(old => old.some(message => message.id === created.id) ? old : [...old, created]);
    } catch (error) {
      Alert.alert('Attachment', error instanceof Error ? error.message : 'Could not send this attachment.');
    } finally {
      setSending(false);
    }
  }

  const title = details?.title || 'Conversation';
  const onlinePresence = presence.filter(member => member.online);
  const peerPresence = onlinePresence.filter(member => member.user_id !== userId);
  const onlineCount = new Set(onlinePresence.map(member => member.user_id)).size;
  const typingMembers = peerPresence.filter(member => member.typing);
  const typingNames = typingMembers.map(member => {
    const profile = details?.members.find(candidate => candidate.id === member.user_id);
    return profile?.display_name || (profile ? '@' + profile.username : 'Someone');
  });
  const typingLabel = typingNames.length === 0
    ? ''
    : !details?.is_group
      ? 'Typing…'
      : typingNames.length === 1
        ? typingNames[0] + ' is typing…'
        : typingNames.length === 2
          ? typingNames[0] + ' and ' + typingNames[1] + ' are typing…'
          : typingNames.length + ' people are typing…';
  const peerOnline = peerPresence.length > 0;

  return <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={{ flex: 1, backgroundColor: '#09090b' }}
  >
    <View style={{ paddingTop: 54, paddingBottom: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
      <Pressable onPress={() => router.back()} style={{ paddingRight: 18, paddingVertical: 6 }}>
        <Text style={{ color: purple, fontSize: 25, fontWeight: '700' }}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: white, fontSize: 16, fontWeight: '900' }} numberOfLines={1}>{title}</Text>
        {details?.is_group
          ? <Text style={{ color: muted, marginTop: 3, fontSize: 11 }}>
              GROUP · {details.members.length} MEMBERS · {presenceReady ? onlineCount + ' ONLINE' : 'CONNECTING'}
            </Text>
          : details?.other_user?.username
            ? <Text style={{ color: muted, marginTop: 3, fontSize: 11 }}>
                @{details.other_user.username} · {presenceReady ? peerOnline ? 'ONLINE' : 'OFFLINE' : 'CONNECTING'}
              </Text>
            : null}
        {typingLabel ? <Text style={{ color: purple, marginTop: 4, fontSize: 11, fontWeight: '700' }}>{typingLabel}</Text> : null}
      </View>
      {details?.is_group ? (
        <Pressable onPress={() => router.push({ pathname: '/group/[id]', params: { id: id ?? '' } })} style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ color: purple, fontSize: 11, fontWeight: '900' }}>MEMBERS</Text>
        </Pressable>
      ) : null}
    </View>

    {loading ? <ActivityIndicator color={purple} style={{ flex: 1 }} /> :
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={message => message.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1, justifyContent: 'flex-end' }}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          nearBottomRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 120;
        }}
        onContentSizeChange={() => {
          if (scrollToBottomRef.current) {
            scrollToBottomRef.current = false;
            listRef.current?.scrollToEnd({ animated: true });
          }
        }}
        ListHeaderComponent={hasMoreMessages || loadingOlder ? (
          <Pressable onPress={() => void loadOlderMessages()} disabled={loadingOlder} style={{ alignItems: 'center', paddingVertical: 12 }}>
            {loadingOlder
              ? <ActivityIndicator color={purple} />
              : <Text style={{ color: purple, fontSize: 11, fontWeight: '900' }}>LOAD EARLIER MESSAGES</Text>}
          </Pressable>
        ) : null}
        ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 50 }}>
          <Text style={{ color: white, fontWeight: '800', fontSize: 18 }}>Say hello.</Text>
          <Text style={{ color: muted, marginTop: 7 }}>Your conversation is ready.</Text>
        </View>}
        renderItem={({ item }) => {
          const mine = item.sender_id === userId;
          const readers = readersByMessage[item.id] ?? [];
          return <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? '#6d4fc3' : '#27272a', borderRadius: 17, borderBottomRightRadius: mine ? 5 : 17, borderBottomLeftRadius: mine ? 17 : 5, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 9 }}>
            {item.media_url ? (
              item.display_media_url
                ? <ChatAttachment uri={item.display_media_url} mediaType={item.media_type} />
                : <Text style={{ color: white, fontSize: 12 }}>Attachment is unavailable. Reopen the conversation to retry.</Text>
            ) : null}
            {item.body ? <Text style={{ color: white, fontSize: 14, lineHeight: 20, marginTop: item.media_url ? 7 : 0 }}>{item.body}</Text> : null}
            <Text style={{ color: '#ded6f3', opacity: 0.75, fontSize: 9, marginTop: 5, alignSelf: 'flex-end' }}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            {mine && readers.length > 0
              ? <Text style={{ color: '#ded6f3', opacity: 0.9, fontSize: 9, marginTop: 3, alignSelf: 'flex-end' }}>{details?.is_group ? 'SEEN BY ' + readers.length : 'SEEN'}</Text>
              : null}
          </View>;
        }}
      />
    }

    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 13, paddingBottom: 18, borderTopWidth: 1, borderTopColor: '#27272a' }}>
      <Pressable
        onPress={() => void pickAttachment()}
        disabled={sending || loading}
        style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: purple, fontSize: 24, fontWeight: '700' }}>＋</Text>
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={updateDraft}
        placeholder="Write a message…"
        placeholderTextColor="#71717a"
        multiline
        maxLength={5000}
        editable={!sending}
        style={{ flex: 1, color: white, backgroundColor: '#18181b', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 11, maxHeight: 120 }}
      />
      <Pressable onPress={() => void submit()} disabled={sending || !draft.trim()} style={{ backgroundColor: sending || !draft.trim() ? '#4c3d6d' : purple, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 16 }}>
        {sending ? <ActivityIndicator color="#181024" /> : <Text style={{ color: '#181024', fontWeight: '900' }}>SEND</Text>}
      </Pressable>
    </View>
  </KeyboardAvoidingView>;
}
