import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRouter } from 'expo-router';
import { blockUser, getVideoFeed, recordVideoView, reportVideo } from '../../lib/social';
import type { VideoPost, VideoReportReason } from '../../lib/types';

const purple = '#a78bfa', white = '#fafafa', muted = '#a1a1aa';
const CARD_HEIGHT = Dimensions.get('window').height - 142;

function VideoCard({ post, active, onOptions }: { post: VideoPost; active: boolean; onOptions: () => void }) {
  const player = useVideoPlayer(post.video_url, instance => { instance.loop = true; });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    if (!active) return;
    let watched = 0;
    let lastSample = Date.now();
    const completionSubscription = player.addListener('playToEnd', () => {
      // The player loops, so use the native end event instead of guessing from
      // currentTime inside a five-second polling window.
      const finalSeconds = Math.floor(watched);
      watched -= finalSeconds;
      void recordVideoView(post.id, finalSeconds, true);
    });
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min((now - lastSample) / 1000, 6);
      lastSample = now;
      if (player.playing) watched += elapsed;
      if (watched >= 5) {
        const batch = Math.floor(watched);
        watched -= batch;
        void recordVideoView(post.id, batch, false);
      }
    }, 5000);
    return () => {
      clearInterval(timer);
      completionSubscription.remove();
      if (watched > 0) void recordVideoView(post.id, watched, false);
    };
  }, [active, player, post.id]);

  return (
    <View style={{ height: CARD_HEIGHT, backgroundColor: '#18181b', borderRadius: 18, overflow: 'hidden', marginBottom: 12 }}>
      <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingTop: 70, backgroundColor: 'rgba(0,0,0,0.28)' }}>
        <Text style={{ color: white, fontWeight: '900', fontSize: 16 }}>@{post.profiles?.username ?? 'creator'}</Text>
        {!!post.caption && <Text style={{ color: white, marginTop: 7, lineHeight: 21 }}>{post.caption}</Text>}
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: 16, left: 16, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }}>
        <Text style={{ color: white, fontSize: 11, fontWeight: '800' }}>PROXY VIDEO</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Video safety options"
        onPress={onOptions}
        hitSlop={8}
        style={{ position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: white, fontSize: 22, fontWeight: '900', lineHeight: 24 }}>•••</Text>
      </Pressable>
    </View>
  );
}

export default function Feed() {
  const router = useRouter();
  const [posts, setPosts] = useState<VideoPost[]>([]);
  const [busy, setBusy] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reportingPost, setReportingPost] = useState<VideoPost | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setBusy(true);
    try { setPosts(await getVideoFeed()); }
    catch (error) { Alert.alert('Feed', error instanceof Error ? error.message : 'Could not load videos.'); }
    finally { setBusy(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openVideoOptions(post: VideoPost) {
    Alert.alert('Video options', '@' + (post.profiles?.username ?? 'creator'), [
      { text: 'Report video', onPress: () => setReportingPost(post) },
      { text: 'Block creator', style: 'destructive', onPress: () => confirmBlock(post) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmBlock(post: VideoPost) {
    const username = post.profiles?.username ?? 'this creator';
    Alert.alert(
      'Block @' + username + '?',
      'You will no longer see each other’s videos or stories, and existing follows will be removed. Existing chats are not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block creator',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await blockUser(post.user_id);
                setPosts(current => current.filter(item => item.user_id !== post.user_id));
                setActiveId(current => current && posts.find(item => item.id === current)?.user_id === post.user_id ? null : current);
                Alert.alert('Creator blocked', '@' + username + ' has been hidden from both feeds.');
              } catch (error) {
                Alert.alert('Block creator', error instanceof Error ? error.message : 'Could not block this creator.');
              }
            })();
          },
        },
      ],
    );
  }

  async function submitVideoReport(reason: VideoReportReason) {
    if (!reportingPost || reportBusy) return;
    setReportBusy(true);
    try {
      await reportVideo(reportingPost.id, reason);
      setReportingPost(null);
      Alert.alert('Report received', 'Thanks for helping keep PROXY safe. This report is private.');
    } catch (error) {
      Alert.alert('Report video', error instanceof Error ? error.message : 'Could not submit this report.');
    } finally {
      setReportBusy(false);
    }
  }

  const reportReasons: Array<{ value: VideoReportReason; label: string }> = [
    { value: 'spam', label: 'Spam or misleading content' },
    { value: 'harassment', label: 'Harassment or bullying' },
    { value: 'hate', label: 'Hateful conduct' },
    { value: 'nudity', label: 'Nudity or sexual content' },
    { value: 'violence', label: 'Violence or dangerous acts' },
    { value: 'copyright', label: 'Copyright infringement' },
    { value: 'other', label: 'Something else' },
  ];


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
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
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
          renderItem={({ item }) => <VideoCard post={item} active={activeId === item.id} onOptions={() => openVideoOptions(item)} />}
        />
      }
      <Modal
        transparent
        animationType="fade"
        visible={reportingPost !== null}
        onRequestClose={() => { if (!reportBusy) setReportingPost(null); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 22 }}>
          <View style={{ backgroundColor: '#18181b', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#3f3f46' }}>
            <Text style={{ color: white, fontSize: 18, fontWeight: '900' }}>Report this video</Text>
            <Text style={{ color: muted, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 12 }}>
              Choose the reason that best describes the issue. Reports are private.
            </Text>
            {reportReasons.map(reason => (
              <Pressable
                key={reason.value}
                disabled={reportBusy}
                onPress={() => void submitVideoReport(reason.value)}
                style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#303036', opacity: reportBusy ? 0.55 : 1 }}
              >
                <Text style={{ color: white, fontSize: 13, fontWeight: '700' }}>{reason.label}</Text>
              </Pressable>
            ))}
            <Pressable
              disabled={reportBusy}
              onPress={() => setReportingPost(null)}
              style={{ alignItems: 'center', paddingTop: 16 }}
            >
              <Text style={{ color: purple, fontWeight: '900' }}>{reportBusy ? 'SUBMITTING…' : 'CANCEL'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
