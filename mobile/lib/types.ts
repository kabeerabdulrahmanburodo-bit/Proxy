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
export type MessageReadReceipt = {
  message_id: string; user_id: string; read_at: string;
};
export type UserSearchResult = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
export type ConversationSummary = {
  id: string;
  is_group: boolean;
  title: string | null;
  created_at: string;
  other_user: UserSearchResult | null;
  last_message: Pick<ChatMessage, 'body' | 'created_at' | 'sender_id'> | null;
};
export type ConversationDetails = {
  id: string;
  is_group: boolean;
  title: string;
  created_by: string;
  other_user: UserSearchResult | null;
  members: UserSearchResult[];
  is_creator: boolean;
};
export type Snap = {
  id: string; user_id: string; media_url: string; media_type: 'image' | 'video';
  expires_at: string; created_at: string;
};
