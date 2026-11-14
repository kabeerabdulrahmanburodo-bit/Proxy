import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { startMediaUpload } from '../../lib/uploads';

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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

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

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', padding: 22, paddingTop: 58 }}>
      <Text style={{ color: purple, fontSize: 22, fontWeight: '900', letterSpacing: 4 }}>PROXY SNAPS</Text>
      <Text style={{ color: white, fontSize: 28, fontWeight: '800', marginTop: 28 }}>Moments that don't stay.</Text>
      <Text style={{ color: muted, lineHeight: 23, marginTop: 10 }}>
        Share a photo or video with your followers. Snaps expire after 24 hours.
      </Text>
      <Pressable
        onPress={() => void postSnap()}
        disabled={busy}
        style={{
          backgroundColor: busy ? '#4c3d6d' : purple,
          padding: 17,
          borderRadius: 15,
          alignItems: 'center',
          marginTop: 28,
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
      <Text style={{ color: muted, fontSize: 11, lineHeight: 18, marginTop: 22 }}>
        Photos up to 15 MB and videos up to 100 MB. If you leave the app during an upload, return to Pending media uploads to continue.
      </Text>
    </View>
  );
}
