import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function usePushNotificationNavigation() {
  useEffect(() => {
    function openDestination(notification: Notifications.Notification) {
      const data = notification.request.content.data as {
        kind?: unknown;
        entity_id?: unknown;
      };
      if (data.kind === 'message' && typeof data.entity_id === 'string') {
        router.push({ pathname: '/chat/[id]', params: { id: data.entity_id } });
      } else {
        router.push('/(tabs)');
      }
      Notifications.clearLastNotificationResponse();
    }

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse?.notification) openDestination(lastResponse.notification);

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      openDestination(response.notification);
    });
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  usePushNotificationNavigation();
  return <><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#09090b' } }} /></>;
}
