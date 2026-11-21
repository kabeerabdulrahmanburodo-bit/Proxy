import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { discardMediaUpload, getPendingMediaUploads, resumeMediaUpload } from '../lib/uploads';
import type { MediaUploadJob } from '../lib/uploads';

const purple = '#a78bfa';
const white = '#fafafa';
const muted = '#a1a1aa';

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function PendingUploadsScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<MediaUploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [progressById, setProgressById] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    try {
      setJobs(await getPendingMediaUploads());
    } catch (error) {
      Alert.alert('Pending uploads', error instanceof Error ? error.message : 'Could not load pending uploads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function resume(job: MediaUploadJob) {
    if (activeId || discardingId) return;
    setActiveId(job.id);
    setProgressById(current => ({ ...current, [job.id]: job.progress }));
    try {
      await resumeMediaUpload(job.id, progress => {
        setProgressById(current => ({ ...current, [job.id]: progress }));
      });
      Alert.alert(
        'Upload complete',
        job.purpose === 'video-post'
          ? 'Your video has been published to Discover.'
          : job.purpose === 'snap'
            ? 'Your snap has been shared with your followers.'
            : 'Your chat attachment has been sent.',
      );
    } catch (error) {
      Alert.alert('Upload could not finish', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally {
      setActiveId(null);
      await refresh();
    }
  }

  function confirmDiscard(job: MediaUploadJob) {
    const kind = job.purpose === 'video-post'
      ? 'video post'
      : job.purpose === 'snap' ? 'Snap' : 'chat attachment';
    Alert.alert(
      'Discard this upload?',
      'The staged copy and any unfinished Storage object will be removed. Already-published or sent media will be kept.',
      [
        { text: 'Keep upload', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDiscardingId(job.id);
              try {
                await discardMediaUpload(job.id);
                Alert.alert('Upload discarded', 'The pending ' + kind + ' was removed from this device.');
                await refresh();
              } catch (error) {
                Alert.alert('Could not discard upload', error instanceof Error ? error.message : 'The upload was kept so it can be recovered.');
              } finally {
                setDiscardingId(null);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: 56 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 }}>
        <Pressable onPress={() => router.back()} style={{ paddingRight: 16, paddingVertical: 6 }}>
          <Text style={{ color: purple, fontSize: 25, fontWeight: '700' }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: white, fontSize: 21, fontWeight: '900' }}>Pending uploads</Text>
          <Text style={{ color: muted, fontSize: 11, marginTop: 3 }}>Resume or safely discard transfers saved on this device</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color={purple} style={{ marginTop: 45 }} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          {jobs.length === 0 ? (
            <View style={{ alignItems: 'center', marginTop: 70 }}>
              <Text style={{ color: white, fontSize: 18, fontWeight: '800' }}>All caught up.</Text>
              <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>There are no unfinished media uploads for this account.</Text>
            </View>
          ) : jobs.map(job => {
            const progress = progressById[job.id] ?? job.progress;
            const busy = activeId === job.id || job.status === 'uploading';
            const discarding = discardingId === job.id;
            return (
              <View key={job.id} style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#303036' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: purple, fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>
                    {job.purpose === 'video-post' ? 'VIDEO POST' : job.purpose === 'snap' ? '24-HOUR SNAP' : 'CHAT ATTACHMENT'}
                  </Text>
                  <Text style={{ color: muted, fontSize: 10 }}>{formatBytes(job.fileSize)}</Text>
                </View>
                <Text style={{ color: white, fontSize: 14, fontWeight: '800', marginTop: 8 }} numberOfLines={1}>{job.fileName}</Text>
                <View style={{ height: 6, borderRadius: 4, backgroundColor: '#303036', overflow: 'hidden', marginTop: 14 }}>
                  <View style={{ width: (Math.round(progress * 100) + '%') as any, height: 6, backgroundColor: purple }} />
                </View>
                <Text style={{ color: muted, fontSize: 10, marginTop: 7 }}>
                  {busy ? 'UPLOADING ' + Math.round(progress * 100) + '%' : discarding ? 'DISCARDING…' : job.status.toUpperCase() + ' · ' + Math.round(progress * 100) + '%'}
                </Text>
                {job.lastError && !busy ? <Text style={{ color: '#fda4af', fontSize: 11, lineHeight: 17, marginTop: 8 }}>{job.lastError}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}>
                  <Pressable
                    onPress={() => void resume(job)}
                    disabled={Boolean(activeId) || Boolean(discardingId) || busy}
                    style={{ flex: 1, backgroundColor: busy ? '#4c3d6d' : purple, padding: 13, borderRadius: 11, alignItems: 'center', opacity: activeId && activeId !== job.id ? 0.55 : 1 }}
                  >
                    {busy && activeId === job.id
                      ? <ActivityIndicator color="#181024" />
                      : <Text style={{ color: '#181024', fontSize: 11, fontWeight: '900' }}>RESUME</Text>}
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDiscard(job)}
                    disabled={Boolean(activeId) || Boolean(discardingId) || busy}
                    style={{ paddingHorizontal: 15, paddingVertical: 13, borderRadius: 11, borderWidth: 1, borderColor: '#7f1d1d', justifyContent: 'center', opacity: busy || discardingId ? 0.45 : 1 }}
                  >
                    <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '900' }}>{discarding ? 'WAIT…' : 'DISCARD'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <Text style={{ color: muted, fontSize: 10, lineHeight: 16, marginTop: 8 }}>
            Transfers use resumable 6 MiB chunks. They pause when the app is backgrounded and resume in the foreground. Unreferenced staged files older than one hour are cleaned automatically. Native OS-managed background transfer is not enabled in this Expo build.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
