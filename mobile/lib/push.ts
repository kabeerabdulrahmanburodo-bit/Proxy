import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const PUSH_TOKEN_KEY = 'proxy.expoPushToken';

export type NotificationPreferences = {
  messages: boolean;
  follows: boolean;
  likes: boolean;
  comments: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  follows: true,
  likes: true,
  comments: true,
};

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('messages,follows,likes,comments')
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        messages: Boolean(data.messages),
        follows: Boolean(data.follows),
        likes: Boolean(data.likes),
        comments: Boolean(data.comments),
      }
    : DEFAULT_NOTIFICATION_PREFERENCES;
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to update notification settings.');
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: user.id,
    ...preferences,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function isPushEnabledOnThisDevice(): Promise<boolean> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    const { error: unregisterError } = await supabase.rpc('unregister_push_device', {
      device_token: token,
    });
    if (unregisterError) throw unregisterError;
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return false;
  }
  const { data, error } = await supabase.from('push_devices')
    .select('enabled')
    .eq('expo_push_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data?.enabled) {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return false;
  }
  return true;
}

export async function registerPushNotifications(): Promise<void> {
  if (!Device.isDevice) {
    throw new Error('Push notifications must be enabled from a physical iPhone or Android device.');
  }
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  if (!platform) throw new Error('Push notifications are supported on iOS and Android only.');

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error('The EAS project ID is not configured. Run eas init in mobile/ and add the generated projectId to app.json before enabling push notifications.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let permissionStatus = current.status;
  if (permissionStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    permissionStatus = requested.status;
  }
  if (permissionStatus !== 'granted') {
    throw new Error('Notification permission was not granted. Enable notifications for PROXY in your device settings.');
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc('register_push_device', {
    device_token: token,
    device_platform: platform,
    device_label: Device.deviceName?.slice(0, 80) ?? null,
  });
  if (error) throw error;
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_device', {
    device_token: token,
  });
  if (error) throw error;
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}
