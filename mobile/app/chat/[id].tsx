import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getConversationDetails, getConversationMessages, sendMessage, subscribeToMessages,
} from '../../lib/social';
import { supabase } from '../../lib/supabase';
import type { ChatMessage, ConversationDetails } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const [details, setDetails] = useState<ConversationDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userId, setUserId] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const channel = subscribeToMessages(id, incoming => {
      setMessages(old => old.some(message => message.id === incoming.id) ? old : [...old, incoming]);
    });
    Promise.all([
      getConversationDetails(id),
      getConversationMessages(id),
      supabase.auth.getUser(),
    ]).then(([conversation, history, auth]) => {
      if (!active) return;
      setDetails(conversation);
      setMessages(old => {
        const byId = new Map(old.map(message => [message.id, message]));
        history.forEach(message => byId.set(message.id, message));
        return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
      setUserId(auth.data.user?.id ?? '');
    }).catch(error => {
      if (active) Alert.alert('Conversation', error instanceof Error ? error.message : 'Could not load this chat.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [id]);

  async function submit() {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      const created = await sendMessage(id, draft);
      setMessages(old => old.some(message => message.id === created.id) ? old : [...old, created]);
      setDraft('');
    } catch (error) {
      Alert.alert('Message', error instanceof Error ? error.message : 'Unable to send your message.');
    } finally {
      setSending(false);
    }
  }

  const title = details?.title || 'Conversation';

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
        {details?.other_user?.username ? <Text style={{ color: muted, marginTop: 3, fontSize: 11 }}>@{details.other_user.username}</Text> : null}
      </View>
    </View>

    {loading ? <ActivityIndicator color={purple} style={{ flex: 1 }} /> :
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={message => message.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1, justifyContent: 'flex-end' }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 50 }}>
          <Text style={{ color: white, fontWeight: '800', fontSize: 18 }}>Say hello.</Text>
          <Text style={{ color: muted, marginTop: 7 }}>Your conversation is ready.</Text>
        </View>}
        renderItem={({ item }) => {
          const mine = item.sender_id === userId;
          return <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: mine ? '#6d4fc3' : '#27272a', borderRadius: 17, borderBottomRightRadius: mine ? 5 : 17, borderBottomLeftRadius: mine ? 17 : 5, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 9 }}>
            <Text style={{ color: white, fontSize: 14, lineHeight: 20 }}>{item.body || 'Shared an attachment'}</Text>
            <Text style={{ color: '#ded6f3', opacity: 0.75, fontSize: 9, marginTop: 5, alignSelf: 'flex-end' }}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>;
        }}
      />
    }

    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 13, paddingBottom: 18, borderTopWidth: 1, borderTopColor: '#27272a' }}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
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
