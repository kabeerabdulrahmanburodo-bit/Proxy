export type Profile = {
  id: string; username: string; display_name: string | null; avatar_url: string | null;
  bio: string | null; created_at: string;
};
export type VideoPost = {
  id: string; user_id: string; caption: string | null; video_url: string;
  thumbnail_url: string | null; created_at: string; likes_count?: number;
  profiles?: Pick<Profile, 'username' | 'avatar_url'>;
};
export type ChatMessage = {
  id: string; conversation_id: string; sender_id: string; body: string;
  media_url: string | null; created_at: string; read_at: string | null;
};
export type Snap = {
  id: string; user_id: string; media_url: string; media_type: 'image' | 'video';
  expires_at: string; created_at: string;
};
