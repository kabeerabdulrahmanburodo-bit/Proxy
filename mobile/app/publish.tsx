import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { publishVideo } from '../lib/social';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';
export default function PublishVideo() {
  const router = useRouter();
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function chooseVideo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to choose a video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'], allowsEditing: false, quality: 1, videoMaxDuration: 180,
    });
    if (!result.canceled) setAsset(result.assets[0]);
  }

  async function submit() {
    if (!asset) { Alert.alert('Choose a video', 'Select a video before publishing.'); return; }
    setBusy(true);
    try {
      const fileName = asset.fileName || 'proxy-video.mp4';
      const mime = asset.mimeType || 'video/mp4';
      setProgress(0);
      await publishVideo(asset.uri, fileName, mime, caption, setProgress);
      Alert.alert('Published', 'Your video is now in the PROXY feed.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) {
      Alert.alert(
        'Upload paused',
        (error instanceof Error ? error.message : 'Please try again.') +
          '\\n\\nIf the connection dropped, your staged file is saved. Resume it from Profile > Pending uploads.',
      );
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#09090b', padding: 22, paddingTop: 58 }}>
      <Pressable onPress={() => router.back()}><Text style={{ color: purple, fontWeight: '800' }}>‹ BACK</Text></Pressable>
      <Text style={{ color: white, fontSize: 29, fontWeight: '900', marginTop: 28 }}>Share a video.</Text>
      <Text style={{ color: muted, marginTop: 8, lineHeight: 22 }}>Choose a clip up to 3 minutes, add a caption, and publish it to Discover.</Text>
      <Pressable onPress={chooseVideo} disabled={busy} style={{ height: 210, borderWidth: 1, borderColor: '#3f3f46', borderStyle: 'dashed', borderRadius: 20, marginTop: 26, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <Text style={{ color: purple, fontSize: 36 }}>＋</Text>
        <Text style={{ color: white, fontWeight: '800', marginTop: 8 }}>{asset?.fileName || 'CHOOSE FROM LIBRARY'}</Text>
        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{asset ? 'Tap to choose another video' : 'MP4 / MOV · Up to 180 seconds'}</Text>
      </Pressable>
      <TextInput value={caption} onChangeText={setCaption} placeholder="Write a caption…" placeholderTextColor="#71717a" multiline maxLength={2200} editable={!busy} style={{ color: white, minHeight: 110, borderRadius: 14, borderWidth: 1, borderColor: '#3f3f46', padding: 15, marginTop: 20, textAlignVertical: 'top' }} />
      <Text style={{ color: muted, textAlign: 'right', marginTop: 6, fontSize: 11 }}>{caption.length}/2200</Text>
      {busy ? (
        <View style={{ marginTop: 18 }}>
          <View style={{ height: 7, borderRadius: 4, backgroundColor: '#27272a', overflow: 'hidden' }}>
            <View style={{ width: Math.round(progress * 100) + '%', height: 7, backgroundColor: purple }} />
          </View>
          <Text style={{ color: muted, fontSize: 11, marginTop: 7, textAlign: 'center' }}>
            Uploading {Math.round(progress * 100)}% · you can return to this screen after a brief background pause
          </Text>
        </View>
      ) : null}
      <Pressable onPress={submit} disabled={busy || !asset} style={{ backgroundColor: !asset || busy ? '#4c3d6d' : purple, padding: 17, borderRadius: 15, alignItems: 'center', marginTop: 22 }}>
        {busy ? <ActivityIndicator color="#181024" /> : <Text style={{ color: '#181024', fontWeight: '900' }}>PUBLISH VIDEO</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}
