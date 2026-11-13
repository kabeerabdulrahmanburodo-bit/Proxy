import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import {
  getNotificationPreferences, isPushEnabledOnThisDevice, registerPushNotifications,
  saveNotificationPreferences, unregisterCurrentPushDevice,
} from '../../lib/push';
import type { NotificationPreferences } from '../../lib/push';

const purple = '#a78bfa';
const white = '#fafafa';
const muted = '#a1a1aa';
const panel = '#18181b';

const preferenceRows: { key: keyof NotificationPreferences; title: string; description: string }[] = [
  { key: 'messages', title: 'Messages', description: 'Direct and group chat messages' },
  { key: 'follows', title: 'New followers', description: 'When someone follows your profile' },
  { key: 'likes', title: 'Video likes', description: 'When someone likes one of your videos' },
  { key: 'comments', title: 'Video comments', description: 'When someone comments on your videos' },
];

export default function Profile() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    messages: true, follows: true, likes: true, comments: true,
  });
  const [pushEnabled, setPushEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        setEmail(user?.email ?? '');
        if (user) {
          const { data } = await supabase.from('profiles')
            .select('username').eq('id', user.id).maybeSingle();
          if (active) setUsername(data?.username ?? '');
        }
        const [nextPreferences, registered] = await Promise.all([
          getNotificationPreferences(),
          isPushEnabledOnThisDevice(),
        ]);
        if (active) {
          setPreferences(nextPreferences);
          setPushEnabled(registered);
        }
      } catch (error) {
        if (active) {
          setSettingsError(error instanceof Error ? error.message : 'Notification settings are unavailable.');
        }
      } finally {
        if (active) setSettingsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function togglePreference(key: keyof NotificationPreferences, value: boolean) {
    const previous = preferences;
    const next = { ...previous, [key]: value };
    setPreferences(next);
    setSaving(true);
    try {
      await saveNotificationPreferences(next);
    } catch (error) {
      setPreferences(previous);
      Alert.alert('Notification settings', error instanceof Error ? error.message : 'Could not save this preference.');
    } finally {
      setSaving(false);
    }
  }

  async function togglePush() {
    setSaving(true);
    try {
      if (pushEnabled) {
        await unregisterCurrentPushDevice();
        setPushEnabled(false);
      } else {
        await registerPushNotifications();
        setPushEnabled(true);
      }
    } catch (error) {
      Alert.alert('Push notifications', error instanceof Error ? error.message : 'Could not update push notifications.');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    try {
      await unregisterCurrentPushDevice();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace('/sign-in');
    } catch (error) {
      Alert.alert('Sign out', error instanceof Error ? error.message : 'Could not safely sign out.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#09090b' }} contentContainerStyle={{ padding: 22, paddingTop: 58, paddingBottom: 48 }}>
      <Text style={{ color: purple, fontSize: 22, fontWeight: '900', letterSpacing: 4 }}>YOUR PROFILE</Text>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center', marginTop: 35 }}>
        <Text style={{ color: purple, fontSize: 32, fontWeight: '900' }}>{(username || email || 'P')[0].toUpperCase()}</Text>
      </View>
      <Text style={{ color: white, fontSize: 25, fontWeight: '800', marginTop: 18 }}>@{username || 'new_user'}</Text>
      <Text style={{ color: muted, marginTop: 6 }}>{email}</Text>

      <View style={{ marginTop: 34, padding: 18, borderRadius: 18, backgroundColor: panel, borderWidth: 1, borderColor: '#303036' }}>
        <Text style={{ color: white, fontSize: 16, fontWeight: '900' }}>PUSH NOTIFICATIONS</Text>
        <Text style={{ color: muted, fontSize: 12, lineHeight: 19, marginTop: 7 }}>
          Choose which PROXY activity can alert this device. You can change these settings any time.
        </Text>
        {settingsLoading ? <ActivityIndicator color={purple} style={{ marginTop: 20 }} /> : (
          <>
            <Pressable
              onPress={() => void togglePush()}
              disabled={saving}
              style={{ backgroundColor: pushEnabled ? '#3f2028' : '#302844', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 17 }}
            >
              {saving ? <ActivityIndicator color={purple} /> : (
                <Text style={{ color: pushEnabled ? '#fda4af' : purple, fontWeight: '900', fontSize: 12 }}>
                  {pushEnabled ? 'DISABLE ON THIS DEVICE' : 'ENABLE PUSH ON THIS DEVICE'}
                </Text>
              )}
            </Pressable>
            {preferenceRows.map(row => (
              <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#303036' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: white, fontWeight: '800', fontSize: 13 }}>{row.title}</Text>
                  <Text style={{ color: muted, fontSize: 11, marginTop: 3 }}>{row.description}</Text>
                </View>
                <Switch
                  value={preferences[row.key]}
                  onValueChange={value => void togglePreference(row.key, value)}
                  disabled={saving}
                  trackColor={{ false: '#3f3f46', true: '#6d5a9e' }}
                  thumbColor={preferences[row.key] ? purple : '#d4d4d8'}
                />
              </View>
            ))}
            {settingsError ? <Text style={{ color: '#fda4af', fontSize: 11, lineHeight: 17, marginTop: 12 }}>{settingsError}</Text> : null}
          </>
        )}
      </View>

      <Text style={{ color: muted, fontSize: 11, lineHeight: 18, marginTop: 14 }}>
        Remote push requires an EAS project ID, Apple/Google push credentials and a development or release build. Expo Go does not support remote push notifications on Android for SDK 54.
      </Text>

      <Pressable
        onPress={() => router.push('/uploads')}
        style={{ backgroundColor: '#302844', padding: 16, borderRadius: 14, marginTop: 28, alignItems: 'center' }}
      >
        <Text style={{ color: purple, fontWeight: '900' }}>PENDING MEDIA UPLOADS</Text>
      </Pressable>

      <Pressable
        onPress={() => void logout()}
        disabled={saving}
        style={{ borderColor: '#3f3f46', borderWidth: 1, padding: 16, borderRadius: 14, marginTop: 12, alignItems: 'center' }}
      >
        <Text style={{ color: white, fontWeight: '800' }}>SIGN OUT</Text>
      </Pressable>
    </ScrollView>
  );
}
