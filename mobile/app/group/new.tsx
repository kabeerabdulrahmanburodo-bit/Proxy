import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createGroupConversation, searchUsers } from '../../lib/social';
import type { UserSearchResult } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';

export default function NewGroupScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<UserSearchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [busy, setBusy] = useState(false);

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
        .catch(error => { if (active) Alert.alert('People', error instanceof Error ? error.message : 'Could not search people.'); })
        .finally(() => { if (active) setSearchBusy(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  function togglePerson(personId: string) {
    setSelectedIds(current => current.includes(personId)
      ? current.filter(id => id !== personId)
      : current.length < 49 ? [...current, personId] : current);
  }

  async function createGroup() {
    if (title.trim().length === 0) {
      Alert.alert('Group name', 'Give your group a name first.');
      return;
    }
    if (selectedIds.length < 2) {
      Alert.alert('Add people', 'Choose at least two other people to create a group.');
      return;
    }
    setBusy(true);
    try {
      const id = await createGroupConversation(title, selectedIds);
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (error) {
      Alert.alert('Create group', error instanceof Error ? error.message : 'Could not create this group.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: 56 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 18 }}>
        <Pressable onPress={() => router.back()} style={{ paddingRight: 16, paddingVertical: 6 }}>
          <Text style={{ color: purple, fontSize: 25, fontWeight: '700' }}>‹</Text>
        </Pressable>
        <View>
          <Text style={{ color: white, fontSize: 20, fontWeight: '900' }}>Create a group</Text>
          <Text style={{ color: muted, fontSize: 11, marginTop: 3 }}>A space for your people.</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }}>GROUP NAME</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Weekend crew"
          placeholderTextColor="#71717a"
          maxLength={60}
          editable={!busy}
          style={{ backgroundColor: '#18181b', color: white, padding: 15, borderRadius: 14, marginTop: 8, borderWidth: 1, borderColor: '#303036' }}
        />
        <Text style={{ color: muted, fontSize: 11, marginTop: 7 }}>Choose at least 2 other people · Up to 50 members total</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or username"
          placeholderTextColor="#71717a"
          autoCapitalize="none"
          returnKeyType="search"
          editable={!busy}
          style={{ backgroundColor: '#18181b', color: white, padding: 15, borderRadius: 14, marginTop: 18, borderWidth: 1, borderColor: '#303036' }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
          <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }}>PEOPLE</Text>
          <Text style={{ color: purple, fontSize: 11, fontWeight: '800' }}>{selectedIds.length} SELECTED</Text>
        </View>
      </View>

      {searchBusy ? <ActivityIndicator color={purple} style={{ marginTop: 28 }} /> :
        <FlatList
          data={people}
          keyExtractor={person => person.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: muted, textAlign: 'center', marginTop: 30, paddingHorizontal: 24 }}>{query.trim().length < 2 ? 'Search for people to add to your group.' : 'No matching people found.'}</Text>}
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            const name = item.display_name || item.username;
            return (
              <Pressable onPress={() => togglePerson(item.id)} disabled={busy || (!selected && selectedIds.length >= 49)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, opacity: !selected && selectedIds.length >= 49 ? 0.45 : 1 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: purple, fontWeight: '900', fontSize: 18 }}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 13 }}>
                  <Text style={{ color: white, fontWeight: '800' }}>{name}</Text>
                  <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>@{item.username}</Text>
                </View>
                <Text style={{ color: selected ? purple : muted, fontWeight: '900', fontSize: 12 }}>{selected ? '✓ ADDED' : '＋ ADD'}</Text>
              </Pressable>
            );
          }}
        />
      }

      <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: '#27272a' }}>
        <Pressable onPress={() => void createGroup()} disabled={busy || !title.trim() || selectedIds.length < 2} style={{ backgroundColor: busy || !title.trim() || selectedIds.length < 2 ? '#4c3d6d' : purple, padding: 16, borderRadius: 15, alignItems: 'center' }}>
          {busy ? <ActivityIndicator color="#181024" /> : <Text style={{ color: '#181024', fontWeight: '900' }}>CREATE GROUP</Text>}
        </Pressable>
      </View>
    </View>
  );
}
