import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, Text, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { getActiveSnapStories } from '../../lib/social';
import { startMediaUpload } from '../../lib/uploads';
import type { SnapStoryGroup } from '../../lib/types';

const purple = '#a78bfa';
const white = '#fafafa';
const muted = '#a1a1aa';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

function inferMimeType(fileName: string | null | undefined, mediaType: 'image' | 'video') {
  const extension = fileName?.split('.').pop()?.toLowerCase();
  if (mediaType === 'video') {
    return extension === 'mov' ? 'video/quicktime' : 'video/mp4';
  }
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export default function Snaps() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stories, setStories] = useState<SnapStoryGroup[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshStories = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) setRefreshing(true);
    else setStoriesLoading(true);
    try {
      setStories(await getActiveSnapStories());
    } catch (error) {
      Alert.alert('Snaps', error instanceof Error ? error.message : 'Could not load stories.');
    } finally {
      setStoriesLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refreshStories();
  }, [refreshStories]));

  async function postSnap() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to post a snap.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const mediaType = asset.type === 'video' ? 'video' : 'image';
      const contentType = (asset.mimeType || inferMimeType(asset.fileName, mediaType))
        .split(';')[0].trim().toLowerCase();

      if (!SUPPORTED_MIME_TYPES.has(contentType)) {
        throw new Error('Choose a JPEG, PNG or WebP photo, or an MP4/MOV video.');
      }

      setBusy(true);
      setProgress(0);
      await startMediaUpload({
        uri: asset.uri,
        fileName: asset.fileName || 'snap-' + Date.now() + (mediaType === 'video' ? '.mp4' : '.jpg'),
        contentType,
        purpose: 'snap',
        mediaType,
        lifetimeHours: 24,
        maxBytes: mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
      }, setProgress);

      await refreshStories(true);
      Alert.alert('Snap posted', 'Your snap is shared with your followers and expires after 24 hours.');
    } catch (error) {
      Alert.alert(
        'Snaps',
        (error instanceof Error ? error.message : 'Upload failed') +
          '\n\nIf the transfer was interrupted, open Profile → Pending media uploads to resume it.',
      );
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  function openStory(group: SnapStoryGroup) {
    const firstSnap = group.snaps[0];
    if (!firstSnap) return;
    router.push({
      pathname: '/snap-viewer',
      params: { userId: group.user_id, snapId: firstSnap.id },
    });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#09090b' }}
      contentContainerStyle={{ padding: 22, paddingTop: 58, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshStories(true)} tintColor={purple} />}
    >
      <Text style={{ color: purple, fontSize: 22, fontWeight: '900', letterSpacing: 4 }}>PROXY SNAPS</Text>
      <Text style={{ color: white, fontSize: 28, fontWeight: '800', marginTop: 28 }}>Moments that don't stay.</Text>
      <Text style={{ color: muted, lineHeight: 23, marginTop: 10 }}>
        Share a photo or video with your followers. Stories disappear after 24 hours.
      </Text>

      <Pressable
        onPress={() => void postSnap()}
        disabled={busy}
        style={{
          backgroundColor: busy ? '#4c3d6d' : purple,
          padding: 17,
          borderRadius: 15,
          alignItems: 'center',
          marginTop: 24,
        }}
      >
        {busy
          ? <ActivityIndicator color="#181024" />
          : <Text style={{ color: '#181024', fontWeight: '900' }}>＋  CREATE A SNAP</Text>}
      </Pressable>
      {busy ? (
        <View style={{ marginTop: 18 }}>
          <View style={{ height: 7, borderRadius: 5, backgroundColor: '#27272a', overflow: 'hidden' }}>
            <View style={{ width: (Math.round(progress * 100) + '%') as any, height: 7, backgroundColor: purple }} />
          </View>
          <Text style={{ color: muted, fontSize: 11, marginTop: 8, textAlign: 'center' }}>
            Uploading {Math.round(progress * 100)}% · resumable transfer
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: 34 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <Text style={{ color: white, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 }}>FOLLOWING STORIES</Text>
          <Text style={{ color: muted, fontSize: 10 }}>EXPIRES IN 24H</Text>
        </View>
        {storiesLoading ? <ActivityIndicator color={purple} style={{ marginTop: 20 }} /> : stories.length === 0 ? (
          <View style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 18 }}>
            <Text style={{ color: white, fontWeight: '800' }}>No active stories yet</Text>
            <Text style={{ color: muted, fontSize: 12, lineHeight: 19, marginTop: 6 }}>
              Your stories and stories from people you follow will appear here.
            </Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingVertical: 5 }}>
            {stories.map(group => {
              const label = group.display_name || group.username;
              return (
                <Pressable key={group.user_id} onPress={() => openStory(group)} style={{ width: 76, alignItems: 'center' }}>
                  <View style={{ width: 68, height: 68, borderRadius: 34, padding: 3, borderWidth: 2, borderColor: purple, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden', backgroundColor: '#302844', alignItems: 'center', justifyContent: 'center' }}>
                      {group.avatar_url
                        ? <Image source={{ uri: group.avatar_url }} style={{ width: 56, height: 56 }} />
                        : <Text style={{ color: purple, fontWeight: '900', fontSize: 20 }}>{label.slice(0, 1).toUpperCase()}</Text>}
                    </View>
                  </View>
                  <Text numberOfLines={1} style={{ color: white, fontSize: 10, fontWeight: '700', marginTop: 8, maxWidth: 76 }}>
                    {group.is_own ? 'Your story' : '@' + group.username}
                  </Text>
                  <Text style={{ color: muted, fontSize: 9, marginTop: 3 }}>{group.snaps.length} {group.snaps.length === 1 ? 'snap' : 'snaps'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Text style={{ color: muted, fontSize: 11, lineHeight: 18, marginTop: 26 }}>
        Photos up to 15 MB and videos up to 100 MB. If you leave the app during an upload, return to Pending media uploads to continue.
      </Text>
    </ScrollView>
  );
}
