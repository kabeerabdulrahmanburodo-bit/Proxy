import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  createDirectConversation, getConversations, searchUsers,
} from '../../lib/social';
import type { ConversationSummary, UserSearchResult } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa', panel = '#18181b';

function Avatar({ label, size = 52 }: { label: string; size?: number }) {
  const initials = label.trim().slice(0, 1).toUpperCase() || '?';
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: purple, fontSize: size * 0.38, fontWeight: '900' }}>{initials}</Text>
  </View>;
}

function ChatRow({ item, onPress }: { item: ConversationSummary; onPress: () => void }) {
  const name = item.is_group ? (item.title || 'Group chat') : (item.other_user?.display_name || item.other_user?.username || 'New chat');
  const preview = item.last_message?.body || 'Start the conversation';
  const time = item.last_message?.created_at || item.created_at;
  return <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 }}>
    <Avatar label={name} />
    <View style={{ flex: 1, marginLeft: 14, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: white, fontSize: 15, fontWeight: '800', flex: 1 }} numberOfLines={1}>{name}</Text>
        <Text style={{ color: muted, fontSize: 10, marginLeft: 8 }}>{new Date(time).toLocaleDateString()}</Text>
      </View>
      <Text style={{ color: muted, fontSize: 13, marginTop: 5 }} numberOfLines={1}>{preview}</Text>
    </View>
  </Pressable>;
}

export default function Chats() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [people, setPeople] = useState<UserSearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [searchBusy, setSearchBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setBusy(true);
    try { setConversations(await getConversations()); }
    catch (error) { Alert.alert('Chats', error instanceof Error ? error.message : 'Could not load conversations.'); }
    finally { setBusy(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPeople([]);
      setSearchBusy(false);
      return;
    }
    let active = true;
    setSearchBusy(true);
    const timer = setTimeout(() => {
      searchUsers(term)
        .then(results => { if (active) setPeople(results); })
        .catch(error => { if (active) Alert.alert('Search', error instanceof Error ? error.message : 'Could not search people.'); })
        .finally(() => { if (active) setSearchBusy(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  function openChat(id: string) {
    router.push({ pathname: '/chat/[id]', params: { id } });
  }

  async function startChat(person: UserSearchResult) {
    setOpeningUserId(person.id);
    try {
      const conversationId = await createDirectConversation(person.id);
      openChat(conversationId);
    } catch (error) {
      Alert.alert('New chat', error instanceof Error ? error.message : 'Could not start this conversation.');
    } finally {
      setOpeningUserId(null);
    }
  }

  const searching = query.trim().length >= 2;

  return <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: 56 }}>
    <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: purple, fontSize: 22, fontWeight: '900', letterSpacing: 4 }}>MESSAGES</Text>
          <Text style={{ color: muted, marginTop: 5, fontSize: 12 }}>Find people and keep the conversation moving.</Text>
        </View>
        <Pressable onPress={() => router.push('/group/new')} style={{ backgroundColor: '#302844', borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11 }}>
          <Text style={{ color: purple, fontWeight: '900', fontSize: 11 }}>＋ GROUP</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or username"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        returnKeyType="search"
        style={{ backgroundColor: panel, color: white, padding: 15, borderRadius: 14, marginTop: 18, borderWidth: 1, borderColor: '#303036' }}
      />
    </View>

    {searching ? <>
      <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 20, paddingBottom: 8 }}>PEOPLE</Text>
      {searchBusy ? <ActivityIndicator color={purple} style={{ marginTop: 24 }} /> :
        <FlatList
          data={people}
          keyExtractor={person => person.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: muted, textAlign: 'center', marginTop: 36 }}>No matching people found.</Text>}
          renderItem={({ item }) => {
            const name = item.display_name || item.username;
            const opening = openingUserId === item.id;
            return <Pressable onPress={() => void startChat(item)} disabled={openingUserId !== null} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13 }}>
              <Avatar label={name} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: white, fontWeight: '800' }}>{name}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>@{item.username}</Text>
              </View>
              {opening ? <ActivityIndicator color={purple} /> : <Text style={{ color: purple, fontWeight: '900' }}>MESSAGE</Text>}
            </Pressable>;
          }}
        />
      </> : <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>RECENT CHATS</Text>
        <Pressable onPress={() => void load(true)}><Text style={{ color: purple, fontSize: 12, fontWeight: '800' }}>REFRESH</Text></Pressable>
      </View>
      {busy ? <ActivityIndicator color={purple} style={{ marginTop: 32 }} /> :
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={purple} />}
          ListEmptyComponent={<View style={{ padding: 28, marginTop: 50, alignItems: 'center' }}>
            <Text style={{ color: white, fontSize: 19, fontWeight: '800' }}>Your chats start here.</Text>
            <Text style={{ color: muted, textAlign: 'center', lineHeight: 22, marginTop: 8 }}>Search for someone above and send your first message.</Text>
          </View>}
          renderItem={({ item }) => <ChatRow item={item} onPress={() => openChat(item.id)} />}
        />
      }
      </>}
  </View>;
}
