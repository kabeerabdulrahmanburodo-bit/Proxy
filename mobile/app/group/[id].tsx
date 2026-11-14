import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addGroupConversationMembers, getConversationDetails, leaveGroupConversation,
  removeGroupConversationMember, searchUsers, transferGroupConversationOwnership,
} from '../../lib/social';
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
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [transferringToId, setTransferringToId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

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

  function confirmRemoveMember(memberId: string, memberName: string) {
    Alert.alert('Remove member?', 'Remove ' + memberName + ' from this group?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void removeMember(memberId); } },
    ]);
  }

  async function removeMember(memberId: string) {
    if (!id || saving || removingMemberId || transferringToId || leaving) return;
    setRemovingMemberId(memberId);
    try {
      await removeGroupConversationMember(id, memberId);
      await load();
      Alert.alert('Group updated', 'The member has been removed.');
    } catch (error) {
      Alert.alert('Remove member', error instanceof Error ? error.message : 'Could not remove this member.');
    } finally {
      setRemovingMemberId(null);
    }
  }

  function confirmTransferOwnership(memberId: string, memberName: string) {
    Alert.alert(
      'Transfer group ownership?',
      memberName + ' will become the group creator. You will remain a member and can leave afterward.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Transfer ownership', onPress: () => { void transferOwnership(memberId, memberName); } },
      ],
    );
  }

  async function transferOwnership(memberId: string, memberName: string) {
    if (!id || saving || removingMemberId || transferringToId || leaving) return;
    setTransferringToId(memberId);
    try {
      await transferGroupConversationOwnership(id, memberId);
      await load();
      Alert.alert('Ownership transferred', memberName + ' is now the group creator. You can leave the group whenever you are ready.');
    } catch (error) {
      Alert.alert('Transfer ownership', error instanceof Error ? error.message : 'Could not transfer group ownership.');
    } finally {
      setTransferringToId(null);
    }
  }

  function confirmLeaveGroup() {
    const deleting = details?.is_creator === true;
    Alert.alert(
      deleting ? 'Delete group?' : 'Leave group?',
      deleting
        ? 'This will permanently delete the group and its messages because you are the only member.'
        : 'You will no longer see this group or its messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: deleting ? 'Delete group' : 'Leave group', style: 'destructive', onPress: () => { void leaveGroup(); } },
      ],
    );
  }

  async function leaveGroup() {
    if (!id || leaving || removingMemberId || transferringToId || saving) return;
    setLeaving(true);
    try {
      await leaveGroupConversation(id);
      router.replace('/(tabs)/chats');
    } catch (error) {
      Alert.alert('Group', error instanceof Error ? error.message : 'Could not leave this group.');
    } finally {
      setLeaving(false);
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
            const isCurrentCreator = member.id === details?.created_by;
            return (
              <View key={member.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: purple, fontWeight: '900', fontSize: 17 }}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: white, fontWeight: '800' }}>{name}</Text>
                  <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>@{member.username}</Text>
                </View>
                {isCurrentCreator
                  ? <Text style={{ color: purple, fontSize: 10, fontWeight: '900' }}>CREATOR</Text>
                  : details?.is_creator ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 6 }}>
                      <Pressable
                        onPress={() => confirmTransferOwnership(member.id, name)}
                        disabled={saving || leaving || removingMemberId !== null || transferringToId !== null}
                        style={{ paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9, backgroundColor: '#302844' }}
                      >
                        <Text style={{ color: purple, fontSize: 9, fontWeight: '900' }}>
                          {transferringToId === member.id ? 'TRANSFERRING…' : 'TRANSFER'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmRemoveMember(member.id, name)}
                        disabled={saving || leaving || removingMemberId !== null || transferringToId !== null}
                        style={{ paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9, backgroundColor: '#3f2028' }}
                      >
                        <Text style={{ color: '#fda4af', fontSize: 9, fontWeight: '900' }}>
                          {removingMemberId === member.id ? 'REMOVING…' : 'REMOVE'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
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
              <Pressable onPress={() => void addMembers()} disabled={saving || selectedIds.length === 0 || removingMemberId !== null || transferringToId !== null || leaving} style={{ backgroundColor: saving || selectedIds.length === 0 ? '#4c3d6d' : purple, padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 20 }}>
                {saving ? <ActivityIndicator color="#181024" /> : <Text style={{ color: '#181024', fontWeight: '900' }}>ADD {selectedIds.length || ''} MEMBERS</Text>}
              </Pressable>
              {details?.members.length === 1 ? (
                <Pressable onPress={confirmLeaveGroup} disabled={leaving || saving || removingMemberId !== null || transferringToId !== null} style={{ backgroundColor: '#3f2028', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 12 }}>
                  {leaving ? <ActivityIndicator color="#fda4af" /> : <Text style={{ color: '#fda4af', fontWeight: '900' }}>DELETE GROUP</Text>}
                </Pressable>
              ) : (
                <>
                  <Text style={{ color: muted, fontSize: 12, lineHeight: 20, marginTop: 14 }}>
                    Transfer ownership to another member before leaving. The new creator will control member additions and removals.
                  </Text>
                  <Pressable onPress={confirmLeaveGroup} disabled={leaving || saving || removingMemberId !== null || transferringToId !== null} style={{ backgroundColor: '#3f2028', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 12 }}>
                    {leaving ? <ActivityIndicator color="#fda4af" /> : <Text style={{ color: '#fda4af', fontWeight: '900' }}>LEAVE GROUP</Text>}
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <View style={{ marginTop: 24 }}>
              <Text style={{ color: muted, fontSize: 12, lineHeight: 20 }}>Only the group creator can add or remove other members.</Text>
              <Pressable onPress={confirmLeaveGroup} disabled={leaving || saving || removingMemberId !== null || transferringToId !== null} style={{ backgroundColor: '#3f2028', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 18 }}>
                {leaving ? <ActivityIndicator color="#fda4af" /> : <Text style={{ color: '#fda4af', fontWeight: '900' }}>LEAVE GROUP</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
