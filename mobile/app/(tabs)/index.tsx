import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRouter } from 'expo-router';
import { getVideoFeed, recordVideoView } from '../../lib/social';
import type { VideoPost } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';
const CARD_HEIGHT = Dimensions.get('window').height - 142;

function VideoCard({ post, active }: { post: VideoPost; active: boolean }) {
  const player = useVideoPlayer(post.video_url, instance => { instance.loop = true; });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    if (!active) return;
    let watched = 0;
    let lastSample = Date.now();
    let completed = false;
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min((now - lastSample) / 1000, 6);
      lastSample = now;
      if (player.playing) watched += elapsed;
      if (player.duration > 0 && player.currentTime / player.duration >= 0.9) completed = true;
      if (watched >= 5) {
        const batch = Math.floor(watched);
        watched -= batch;
        void recordVideoView(post.id, batch, completed);
        completed = false;
      }
    }, 5000);
    return () => {
      clearInterval(timer);
      if (watched > 0 || completed) void recordVideoView(post.id, watched, completed);
    };
  }, [active, player, post.id]);

  return (
    <View style={{ height: CARD_HEIGHT, backgroundColor: '#18181b', borderRadius: 18, overflow: 'hidden', marginBottom: 12 }}>
      <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingTop: 70, backgroundColor: 'rgba(0,0,0,0.28)' }}>
        <Text style={{ color: white, fontWeight: '900', fontSize: 16 }}>@{post.profiles?.username ?? 'creator'}</Text>
        {!!post.caption && <Text style={{ color: white, marginTop: 7, lineHeight: 21 }}>{post.caption}</Text>}
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }}>
        <Text style={{ color: white, fontSize: 11, fontWeight: '800' }}>PROXY VIDEO</Text>
      </View>
    </View>
  );
}

export default function Feed() {
  const router = useRouter();
  const [posts, setPosts] = useState<VideoPost[]>([]);
  const [busy, setBusy] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setBusy(true);
    try { setPosts(await getVideoFeed()); }
    catch (error) { Alert.alert('Feed', error instanceof Error ? error.message : 'Could not load videos.'); }
    finally { setBusy(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item: VideoPost; isViewable: boolean }> }) => {
    const visible = viewableItems.find(item => item.isViewable);
    setActiveId(visible?.item.id ?? null);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 }).current;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: 52 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: purple, fontSize: 22, fontWeight: '900', letterSpacing: 4 }}>PROXY</Text>
          <Text style={{ color: muted, fontSize: 10, letterSpacing: 2, marginTop: 2 }}>DISCOVER YOUR NEXT LOOP</Text>
        </View>
        <Pressable onPress={() => router.push('/publish')} style={{ backgroundColor: purple, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22 }}>
          <Text style={{ color: '#181024', fontWeight: '900' }}>＋ POST</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={purple} style={{ marginTop: 60 }} /> :
        <FlatList
          data={posts}
          keyExtractor={post => post.id}
          pagingEnabled
          snapToAlignment="start"
          decelerationRate="fast"
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={purple} />}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          ListEmptyComponent={<View style={{ padding: 28, marginTop: 70, alignItems: 'center' }}>
            <Text style={{ color: white, fontSize: 20, fontWeight: '800' }}>Your feed starts here.</Text>
            <Text style={{ color: muted, textAlign: 'center', lineHeight: 22, marginTop: 8 }}>Post the first video or follow creators to fill your For You feed.</Text>
            <Pressable onPress={() => router.push('/publish')} style={{ marginTop: 20, backgroundColor: purple, padding: 14, borderRadius: 14 }}>
              <Text style={{ color: '#181024', fontWeight: '900' }}>UPLOAD A VIDEO</Text>
            </Pressable>
          </View>}
          renderItem={({ item }) => <VideoCard post={item} active={activeId === item.id} />}
        />
      }
    </View>
  );
}
