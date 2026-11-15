import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  getActiveSnapsForUser, getSnapViewCount, recordSnapView, resolveSnapMediaUrl,
} from '../lib/social';
import { supabase } from '../lib/supabase';
import type { SnapStory } from '../lib/types';

const purple = '#a78bfa';
const white = '#fafafa';
const muted = '#a1a1aa';
const SCREEN_WIDTH = Dimensions.get('window').width;

function StoryVideo({ uri, onFinished }: { uri: string; onFinished: () => void }) {
  const finished = useRef(false);
  const player = useVideoPlayer(uri, instance => { instance.loop = false; });

  useEffect(() => {
    finished.current = false;
    player.play();
    const timer = setInterval(() => {
      if (
        !finished.current &&
        player.duration > 0 &&
        player.currentTime >= Math.max(0, player.duration - 0.25) &&
        !player.playing
      ) {
        finished.current = true;
        onFinished();
      }
    }, 250);
    return () => {
      clearInterval(timer);
      player.pause();
    };
  }, [onFinished, player]);

  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export default function SnapViewerScreen() {
  const params = useLocalSearchParams<{ userId: string | string[]; snapId?: string | string[] }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const startingSnapId = Array.isArray(params.snapId) ? params.snapId[0] : params.snapId;
  const router = useRouter();

  const [snaps, setSnaps] = useState<SnapStory[]>([]);
  const [index, setIndex] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!userId) {
        setError('This story link is incomplete.');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [{ data: { user } }, stories] = await Promise.all([
          supabase.auth.getUser(),
          getActiveSnapsForUser(userId),
        ]);
        if (!active) return;
        setViewerId(user?.id ?? null);
        setSnaps(stories);
        const startIndex = startingSnapId
          ? stories.findIndex(story => story.id === startingSnapId)
          : 0;
        setIndex(startIndex >= 0 ? startIndex : 0);
        if (stories.length === 0) setError('There are no active Snaps in this story.');
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this story.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [startingSnapId, userId]);

  const current = snaps[index];

  const next = useCallback(() => {
    if (index + 1 < snaps.length) setIndex(index + 1);
    else router.back();
  }, [index, router, snaps.length]);

  const previous = useCallback(() => {
    if (index > 0) setIndex(index - 1);
  }, [index]);

  useEffect(() => {
    if (!current) return;
    let active = true;
    setMediaUri(null);
    setError(null);
    setViewCount(null);

    void resolveSnapMediaUrl(current)
      .then(uri => {
        if (!active) return;
        setMediaUri(uri);
        if (viewerId && current.user_id !== viewerId) {
          void recordSnapView(current.id).catch(viewError => {
            console.warn('Could not record Snap view:', viewError instanceof Error ? viewError.message : viewError);
          });
        } else if (viewerId && current.user_id === viewerId) {
          void getSnapViewCount(current.id)
            .then(count => { if (active) setViewCount(count); })
            .catch(countError => console.warn('Could not load Snap audience count:', countError));
        }
      })
      .catch(resolveError => {
        if (active) setError(resolveError instanceof Error ? resolveError.message : 'Snap media could not be opened.');
      });

    const expiresIn = Math.max(0, Date.parse(current.expires_at) - Date.now());
    const expiryTimer = setTimeout(next, expiresIn);
    return () => {
      active = false;
      clearTimeout(expiryTimer);
    };
  }, [current?.id, next, viewerId]);

  useEffect(() => {
    if (!current || current.media_type !== 'image' || !mediaUri) return;
    const timer = setTimeout(next, 5000);
    return () => clearTimeout(timer);
  }, [current?.id, current?.media_type, mediaUri, next]);

  const creator = current?.profiles?.display_name || current?.profiles?.username || 'PROXY member';

  return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={purple} size="large" /> : !current ? (
        <View style={{ padding: 28, alignItems: 'center' }}>
          <Text style={{ color: white, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Story unavailable</Text>
          <Text style={{ color: muted, marginTop: 9, textAlign: 'center', lineHeight: 21 }}>{error || 'This story may have expired.'}</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 22, backgroundColor: purple, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 }}>
            <Text style={{ color: '#181024', fontWeight: '900' }}>CLOSE</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {mediaUri ? (
            current.media_type === 'video'
              ? <StoryVideo key={current.id} uri={mediaUri} onFinished={next} />
              : <Image source={{ uri: mediaUri }} resizeMode="contain" style={{ width: SCREEN_WIDTH, height: '100%' }} />
          ) : (
            <View style={{ alignItems: 'center', padding: 30 }}>
              {error ? (
                <>
                  <Text style={{ color: white, fontWeight: '800', textAlign: 'center' }}>Snap unavailable</Text>
                  <Text style={{ color: muted, marginTop: 8, textAlign: 'center' }}>{error}</Text>
                  <Pressable onPress={next} style={{ marginTop: 18, padding: 12 }}>
                    <Text style={{ color: purple, fontWeight: '900' }}>SKIP</Text>
                  </Pressable>
                </>
              ) : <ActivityIndicator color={purple} size="large" />}
            </View>
          )}

          <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <View style={{ position: 'absolute', top: 48, left: 12, right: 64, flexDirection: 'row', gap: 4 }}>
              {snaps.map((snap, snapIndex) => (
                <View key={snap.id} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: snapIndex <= index ? white : 'rgba(255,255,255,0.35)' }} />
              ))}
            </View>

            <View style={{ position: 'absolute', top: 62, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#302844', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {current.profiles?.avatar_url
                  ? <Image source={{ uri: current.profiles.avatar_url }} style={{ width: 38, height: 38 }} />
                  : <Text style={{ color: purple, fontWeight: '900' }}>{creator.slice(0, 1).toUpperCase()}</Text>}
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: white, fontWeight: '900' }}>{creator}</Text>
                <Text style={{ color: '#d4d4d8', fontSize: 10, marginTop: 2 }}>
                  {new Date(current.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              {viewCount !== null ? <Text style={{ color: white, fontSize: 11 }}>{viewCount} views</Text> : null}
            </View>

            <Pressable onPress={previous} style={{ position: 'absolute', left: 0, top: 115, bottom: 100, width: '35%' }} />
            <Pressable onPress={next} style={{ position: 'absolute', right: 0, top: 115, bottom: 100, width: '65%' }} />

            {current.caption ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: 18, right: 18, bottom: 48, padding: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.42)' }}>
                <Text style={{ color: white, fontSize: 14, lineHeight: 21 }}>{current.caption}</Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ position: 'absolute', top: 52, right: 16, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: white, fontSize: 23, lineHeight: 25 }}>×</Text>
          </Pressable>
          <View pointerEvents="none" style={{ position: 'absolute', bottom: 18, alignSelf: 'center' }}>
            <Text style={{ color: '#d4d4d8', fontSize: 10 }}>Tap right to continue · tap left to go back</Text>
          </View>
        </>
      )}
    </View>
  );
}
