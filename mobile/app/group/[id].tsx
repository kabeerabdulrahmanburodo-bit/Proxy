import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addGroupConversationMembers, getConversationDetails, searchUsers } from '../../lib/social';
import type { ConversationDetails, UserSearchResult } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';

export default function GroupDetailsScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const [details, setDetails] = useState<ConversationDetails | null>(null);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<UserSearchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchBusy, setSearchBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await getConversationDetails(id);
      if (!result.is_group) {
        Alert.alert('Group', 'This conversation is not a group.');
        router.back();
        return;
      }
      setDetails(result);
    } catch (error) {
      Alert.alert('Group', error instanceof Error ? error.message : 'Could not load group members.');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

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
    const existingIds = new Set((details?.members ?? []).map(member => member.id));
    const timer = setTimeout(() => {
      searchUsers(term)
        .then(results => { if (active) setPeople(results.filter(person => !existingIds.has(person.id))); })
        .catch(error => { if (active) Alert.alert('People', error instanceof Error ? error.message : 'Could not search people.'); })
        .finally(() => { if (active) setSearchBusy(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, details?.members]);

  function togglePerson(personId: string) {
    setSelectedIds(current => current.includes(personId)
      ? current.filter(value => value !== personId)
      : [...current, personId]);
  }

  async function addMembers() {
    if (!id || selectedIds.length === 0 || saving) return;
    setSaving(true);
    try {
      const added = await addGroupConversationMembers(id, selectedIds);
      setSelectedIds([]);
      setQuery('');
      await load();
      Alert.alert('Group updated', added === 1 ? '1 member added.' : added + ' members added.');
    } catch (error) {
      Alert.alert('Add members', error instanceof Error ? error.message : 'Could not add these people.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: 56 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 18 }}>
        <Pressable onPress={() => router.back()} style={{ paddingRight: 16, paddingVertical: 6 }}>
          <Text style={{ color: purple, fontSize: 25, fontWeight: '700' }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: white, fontSize: 20, fontWeight: '900' }}>{details?.title || 'Group members'}</Text>
          <Text style={{ color: muted, fontSize: 11, marginTop: 3 }}>{details?.members.length ?? 0} members</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color={purple} style={{ marginTop: 50 }} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginBottom: 8 }}>MEMBERS</Text>
          {(details?.members ?? []).map(member => {
            const name = member.display_name || member.username;
            return (
              <View key={member.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: purple, fontWeight: '900', fontSize: 17 }}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: white, fontWeight: '800' }}>{name}</Text>
                  <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>@{member.username}</Text>
                </View>
                {member.id === details?.created_by
                  ? <Text style={{ color: purple, fontSize: 10, fontWeight: '900' }}>CREATOR</Text>
                  : null}
              </View>
            );
          })}

          {details?.is_creator ? (
            <>
              <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginTop: 28 }}>ADD PEOPLE</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or username"
                placeholderTextColor="#71717a"
                autoCapitalize="none"
                editable={!saving}
                style={{ backgroundColor: '#18181b', color: white, padding: 15, borderRadius: 14, marginTop: 10, borderWidth: 1, borderColor: '#303036' }}
              />
              {searchBusy ? <ActivityIndicator color={purple} style={{ marginTop: 18 }} /> : (
                <View style={{ marginTop: 8 }}>
                  {people.map(person => {
                    const selected = selectedIds.includes(person.id);
                    const name = person.display_name || person.username;
                    return (
                      <Pressable key={person.id} onPress={() => togglePerson(person.id)} disabled={saving} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: white, fontWeight: '800' }}>{name}</Text>
                          <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>@{person.username}</Text>
                        </View>
                        <Text style={{ color: selected ? purple : muted, fontWeight: '900', fontSize: 11 }}>{selected ? '✓ SELECTED' : '＋ ADD'}</Text>
                      </Pressable>
                    );
                  })}
                  {query.trim().length < 2 ? <Text style={{ color: muted, marginTop: 10, fontSize: 12 }}>Search for people who are not already in this group.</Text> : null}
                  {query.trim().length >= 2 && !searchBusy && people.length === 0 ? <Text style={{ color: muted, marginTop: 10, fontSize: 12 }}>No new people found.</Text> : null}
                </View>
              )}
              <Pressable onPress={() => void addMembers()} disabled={saving || selectedIds.length === 0} style={{ backgroundColor: saving || selectedIds.length === 0 ? '#4c3d6d' : purple, padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 20 }}>
                {saving ? <ActivityIndicator color="#181024" /> : <Text style={{ color: '#181024', fontWeight: '900' }}>ADD {selectedIds.length || ''} MEMBERS</Text>}
              </Pressable>
            </>
          ) : (
            <Text style={{ color: muted, fontSize: 12, lineHeight: 20, marginTop: 24 }}>Only the group creator can add members in this version.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
