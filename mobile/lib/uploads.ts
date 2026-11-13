import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as tus from 'tus-js-client';
import { supabase } from './supabase';
import type { ChatMessage, VideoPost } from './types';

export type MediaUploadPurpose = 'video-post' | 'chat-attachment';
export type MediaUploadStatus = 'queued' | 'uploading' | 'paused' | 'failed';

export interface MediaUploadJob {
  id: string;
  ownerId: string;
  purpose: MediaUploadPurpose;
  bucket: 'videos' | 'chat-attachments';
  objectPath: string;
  stagedUri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  progress: number;
  status: MediaUploadStatus;
  lastError?: string;
  caption?: string;
  conversationId?: string;
  mediaType?: 'image' | 'video';
}

interface CreateMediaUploadInput {
  uri: string;
  fileName?: string | null;
  contentType?: string | null;
  purpose: MediaUploadPurpose;
  maxBytes: number;
  caption?: string;
  conversationId?: string;
  mediaType?: 'image' | 'video';
}

interface TusUrlEntry {
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
}

const JOBS_KEY = 'proxy:media-upload-jobs:v1';
const TUS_URLS_KEY = 'proxy:tus-upload-urls:v1';
const UPLOAD_DIRECTORY = 'proxy-upload-queue';
const CHUNK_SIZE = 6 * 1024 * 1024;
const activeJobs = new Set<string>();

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function safeFileName(value: string) {
  const leaf = value.split(/[\\/]/).pop() || 'upload.bin';
  return leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || 'upload.bin';
}

async function readJobs(): Promise<MediaUploadJob[]> {
  const raw = await AsyncStorage.getItem(JOBS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MediaUploadJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: MediaUploadJob[]) {
  await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
}

async function updateJob(jobId: string, patch: Partial<MediaUploadJob>) {
  const jobs = await readJobs();
  const next = jobs.map(job => job.id === jobId ? { ...job, ...patch } : job);
  await writeJobs(next);
}

async function readTusEntries(): Promise<TusUrlEntry[]> {
  const raw = await AsyncStorage.getItem(TUS_URLS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TusUrlEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// React Native has no Web Storage API, so tus-js-client receives an AsyncStorage-backed
// URL store. It contains resumable session URLs only; access tokens are never persisted here.
const tusUrlStorage = {
  async findAllUploads() {
    return readTusEntries();
  },
  async findUploadsByFingerprint(fingerprint: string) {
    const prefix = 'tus::' + fingerprint + '::';
    return (await readTusEntries()).filter(entry => entry.urlStorageKey.startsWith(prefix));
  },
  async removeUpload(urlStorageKey: string) {
    const entries = await readTusEntries();
    await AsyncStorage.setItem(TUS_URLS_KEY, JSON.stringify(
      entries.filter(entry => entry.urlStorageKey !== urlStorageKey)
    ));
  },
  async addUpload(fingerprint: string, upload: Omit<TusUrlEntry, 'urlStorageKey'> | TusUrlEntry) {
    const urlStorageKey = 'tus::' + fingerprint + '::' + makeId();
    const entry = { ...upload, urlStorageKey } as TusUrlEntry;
    const entries = await readTusEntries();
    await AsyncStorage.setItem(TUS_URLS_KEY, JSON.stringify([
      ...entries.filter(item => item.urlStorageKey !== urlStorageKey),
      entry,
    ]));
    return urlStorageKey;
  },
};

async function clearTusEntries(jobId: string) {
  const entries = await tusUrlStorage.findUploadsByFingerprint('proxy-' + jobId);
  await Promise.all(entries.map(entry => tusUrlStorage.removeUpload(entry.urlStorageKey)));
}

export async function createMediaUploadJob(input: CreateMediaUploadInput): Promise<MediaUploadJob> {
  if (!input.uri) throw new Error('Choose a file before uploading.');
  if (input.purpose === 'video-post' && (input.caption?.length ?? 0) > 2200) {
    throw new Error('Caption must be 2,200 characters or fewer.');
  }
  if (input.purpose === 'chat-attachment' && (!input.conversationId || !input.mediaType)) {
    throw new Error('A conversation and attachment type are required.');
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in before uploading.');

  const source = new File(input.uri);
  if (!source.exists) throw new Error('The selected file is no longer available. Please choose it again.');
  const sourceSize = source.size;
  if (!Number.isFinite(sourceSize) || sourceSize <= 0) throw new Error('Could not determine the selected file size.');
  if (sourceSize > input.maxBytes) {
    throw new Error('This file is larger than the allowed upload limit of ' +
      Math.round(input.maxBytes / (1024 * 1024)) + ' MB.');
  }
  if (Paths.availableDiskSpace > 0 && sourceSize > Paths.availableDiskSpace) {
    throw new Error('There is not enough free device storage to safely queue this upload.');
  }

  const id = makeId();
  const fileName = safeFileName(input.fileName || source.name || 'upload.bin');
  const contentType = (input.contentType || source.type || 'application/octet-stream')
    .split(';')[0].trim().toLowerCase();
  const directory = new Directory(Paths.document, UPLOAD_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const stagedFile = new File(directory, id + '-' + fileName);
  await source.copy(stagedFile);
  if (!stagedFile.exists || stagedFile.size !== sourceSize) {
    if (stagedFile.exists) stagedFile.delete();
    throw new Error('Could not safely stage the selected file for a resumable upload.');
  }

  const objectName = id + '-' + fileName;
  const objectPath = input.purpose === 'video-post'
    ? user.id + '/' + objectName
    : input.conversationId + '/' + user.id + '/' + objectName;

  const job: MediaUploadJob = {
    id,
    ownerId: user.id,
    purpose: input.purpose,
    bucket: input.purpose === 'video-post' ? 'videos' : 'chat-attachments',
    objectPath,
    stagedUri: stagedFile.uri,
    fileName,
    contentType,
    fileSize: sourceSize,
    createdAt: new Date().toISOString(),
    progress: 0,
    status: 'queued',
    caption: input.purpose === 'video-post' ? (input.caption || '').trim() : undefined,
    conversationId: input.conversationId,
    mediaType: input.mediaType,
  };

  try {
    const jobs = await readJobs();
    await writeJobs([...jobs, job]);
  } catch (error) {
    stagedFile.delete();
    throw error;
  }
  return job;
}

export async function getPendingMediaUploads(): Promise<MediaUploadJob[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const jobs = await readJobs();
  const visible = jobs
    .filter(job => job.ownerId === user.id)
    .map(job => job.status === 'uploading' && !activeJobs.has(job.id)
      ? { ...job, status: 'paused' as const }
      : job)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  await writeJobs(jobs.map(job => {
    const refreshed = visible.find(item => item.id === job.id);
    return refreshed ?? job;
  }));
  return visible;
}

function tusEndpoint() {
  const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) throw new Error('Configure EXPO_PUBLIC_SUPABASE_URL before uploading.');
  const projectUrl = new URL(configuredUrl);
  const match = projectUrl.hostname.match(/^([a-z0-9-]+)\\.supabase\\.co$/i);
  const storageOrigin = match
    ? 'https://' + match[1] + '.storage.supabase.co'
    : projectUrl.origin;
  return storageOrigin + '/storage/v1/upload/resumable';
}

async function getObjectExists(job: MediaUploadJob): Promise<boolean> {
  const slash = job.objectPath.lastIndexOf('/');
  const parent = job.objectPath.slice(0, slash);
  const fileName = job.objectPath.slice(slash + 1);
  const { data, error } = await supabase.storage.from(job.bucket).list(parent, {
    search: fileName,
    limit: 100,
  });
  if (error) throw error;
  return (data ?? []).some(item => item.name === fileName);
}

async function uploadWithTus(
  job: MediaUploadJob,
  stagedFile: File,
  onProgress?: (progress: number) => void,
) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) throw new Error('Your session has expired. Sign in again to resume this upload.');

  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Configure EXPO_PUBLIC_SUPABASE_ANON_KEY before uploading.');

  const fileReader = {
    async openFile(input: unknown) {
      const file = input as File;
      const size = file.size;
      return {
        size,
        async slice(start: number, end: number) {
          const boundedEnd = Math.min(Number.isFinite(end) ? end : size, size);
          if (start >= boundedEnd) return { value: null, done: true };
          return {
            value: file.slice(start, boundedEnd, job.contentType),
            done: boundedEnd >= size,
          };
        },
        close() {},
      };
    },
  };

  let finishUpload: (error?: Error) => void = () => undefined;
  let intentionalPause = false;
  const options = {
    endpoint: tusEndpoint(),
    chunkSize: CHUNK_SIZE,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + session.access_token,
    },
    metadata: {
      bucketName: job.bucket,
      objectName: job.objectPath,
      contentType: job.contentType,
      cacheControl: '3600',
    },
    uploadDataDuringCreation: false,
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: false,
    fingerprint: async () => 'proxy-' + job.id,
    urlStorage: tusUrlStorage,
    fileReader,
    onBeforeRequest: async (request: { setHeader: (name: string, value: string) => void }) => {
      const { data: { session: freshSession }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!freshSession) throw new Error('Your session expired during upload. Sign in and resume.');
      request.setHeader('Authorization', 'Bearer ' + freshSession.access_token);
      request.setHeader('apikey', anonKey);
    },
    onProgress: (bytesUploaded: number, bytesTotal: number) => {
      const progress = bytesTotal > 0 ? Math.min(1, bytesUploaded / bytesTotal) : 0;
      onProgress?.(progress);
      void updateJob(job.id, { progress }).catch(error => console.warn('Could not persist upload progress:', error));
    },
    onError: (error: Error) => {
      if (intentionalPause && error.name === 'AbortError') return;
      finishUpload(error);
    },
    onSuccess: () => finishUpload(),
  } as unknown as NonNullable<ConstructorParameters<typeof tus.Upload>[1]>;

  const upload = new tus.Upload(stagedFile, options);
  const previousUploads = await upload.findPreviousUploads();
  if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let inactive = AppState.currentState !== 'active';
    let pausePromise: Promise<void> = Promise.resolve();

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      appStateSubscription.remove();
      if (error) reject(error);
      else resolve();
    };

    const start = () => {
      if (settled || inactive) return;
      intentionalPause = false;
      void updateJob(job.id, { status: 'uploading', lastError: undefined })
        .catch(error => console.warn('Could not update upload status:', error));
      try {
        upload.start();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Could not start the resumable upload.'));
      }
    };

    finishUpload = finish;
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' && !inactive) {
        inactive = true;
        intentionalPause = true;
        void updateJob(job.id, { status: 'paused' })
          .catch(error => console.warn('Could not save paused upload status:', error));
        pausePromise = upload.abort().catch(() => undefined);
      } else if (nextState === 'active' && inactive) {
        inactive = false;
        void pausePromise.then(start);
      }
    });

    if (inactive) {
      void updateJob(job.id, { status: 'paused' })
        .catch(error => console.warn('Could not save paused upload status:', error));
    } else {
      start();
    }
  });
}

async function finalizeUpload(job: MediaUploadJob): Promise<VideoPost | ChatMessage> {
  if (job.purpose === 'video-post') {
    const { data: publicData } = supabase.storage.from('videos').getPublicUrl(job.objectPath);
    const existing = await supabase.from('videos')
      .select('id,user_id,caption,video_url,thumbnail_url,created_at')
      .eq('user_id', job.ownerId)
      .eq('video_url', publicData.publicUrl)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as VideoPost;

    const { data, error } = await supabase.from('videos').insert({
      user_id: job.ownerId,
      caption: job.caption || null,
      video_url: publicData.publicUrl,
      visibility: 'public',
    }).select('id,user_id,caption,video_url,thumbnail_url,created_at').single();
    if (error) throw error;
    return data as VideoPost;
  }

  const existing = await supabase.from('messages').select('*')
    .eq('conversation_id', job.conversationId!)
    .eq('sender_id', job.ownerId)
    .eq('media_url', job.objectPath)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as ChatMessage;

  const { data, error } = await supabase.from('messages').insert({
    conversation_id: job.conversationId,
    sender_id: job.ownerId,
    body: job.mediaType === 'image' ? 'Shared a photo' : 'Shared a video',
    media_url: job.objectPath,
    media_type: job.mediaType,
  }).select('*').single();
  if (error) throw error;
  return data as ChatMessage;
}

async function completeJob(job: MediaUploadJob) {
  const result = await finalizeUpload(job);
  try {
    await clearTusEntries(job.id);
  } catch (error) {
    console.warn('The completed TUS session could not be cleared from local storage:', error);
  }
  try {
    const jobs = await readJobs();
    await writeJobs(jobs.filter(item => item.id !== job.id));
  } catch (error) {
    // Keep the job if local queue cleanup fails. A retry detects the existing Storage
    // object and database row, then safely repeats only the local cleanup.
    console.warn('The completed upload could not be removed from the local queue:', error);
  }
  try {
    const staged = new File(job.stagedUri);
    if (staged.exists) staged.delete();
  } catch (error) {
    console.warn('Uploaded media is safe, but its local staged copy could not be removed:', error);
  }
  return result;
}

export async function resumeMediaUpload(
  jobId: string,
  onProgress?: (progress: number) => void,
): Promise<VideoPost | ChatMessage> {
  if (activeJobs.has(jobId)) throw new Error('This upload is already running.');
  activeJobs.add(jobId);
  let job: MediaUploadJob | undefined;
  try {
    const jobs = await readJobs();
    job = jobs.find(item => item.id === jobId);
    if (!job) throw new Error('This pending upload could not be found.');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== job.ownerId) throw new Error('Sign in with the account that started this upload.');

    await updateJob(job.id, { status: 'uploading', lastError: undefined });
    const stagedFile = new File(job.stagedUri);
    if (!stagedFile.exists || stagedFile.size !== job.fileSize) {
      throw new Error('The saved upload file is missing or has changed. Choose the original media again.');
    }

    if (!(await getObjectExists(job))) {
      await uploadWithTus(job, stagedFile, onProgress);
    } else {
      onProgress?.(1);
      await updateJob(job.id, { progress: 1 });
    }

    try {
      return await completeJob(job);
    } catch (error) {
      const { error: cleanupError } = await supabase.storage.from(job.bucket).remove([job.objectPath]);
      if (!cleanupError) await clearTusEntries(job.id);
      else console.warn('Could not clean up an uploaded object after database finalization failed:', cleanupError.message);
      throw error;
    }
  } catch (error) {
    if (job) {
      const message = error instanceof Error ? error.message : 'Upload could not be completed.';
      await updateJob(job.id, { status: 'failed', lastError: message });
    }
    throw error;
  } finally {
    activeJobs.delete(jobId);
  }
}

export async function startMediaUpload(
  input: CreateMediaUploadInput,
  onProgress?: (progress: number) => void,
): Promise<VideoPost | ChatMessage> {
  const job = await createMediaUploadJob(input);
  return resumeMediaUpload(job.id, onProgress);
}
