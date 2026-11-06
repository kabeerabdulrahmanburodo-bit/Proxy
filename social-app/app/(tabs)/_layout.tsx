import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const inactive = "#858591";
const active = "#FFFFFF";

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: "#101016", borderTopColor: "#252530", height: 62, paddingTop: 7 },
      tabBarActiveTintColor: active,
      tabBarInactiveTintColor: inactive,
      tabBarLabelStyle: { fontSize: 10, marginBottom: 4 }
    }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="play-circle" color={color} size={size} /> }} />
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} /> }} />
      <Tabs.Screen name="create" options={{ title: "Create", tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size + 8} /> }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-ellipses" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} /> }} />
    </Tabs>
  );
}
