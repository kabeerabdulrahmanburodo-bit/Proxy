import { Tabs } from 'expo-router';
import { Text } from 'react-native';
const purple='#a78bfa';
export default function TabLayout(){
 return <Tabs screenOptions={{headerShown:false,tabBarStyle:{backgroundColor:'#111114',borderTopColor:'#27272a',height:62,paddingBottom:8},tabBarActiveTintColor:purple,tabBarInactiveTintColor:'#71717a'}}>
  <Tabs.Screen name="index" options={{title:'Discover',tabBarIcon:({color})=><Text style={{color}}>◉</Text>}}/>
  <Tabs.Screen name="chats" options={{title:'Chats',tabBarIcon:({color})=><Text style={{color}}>▤</Text>}}/>
  <Tabs.Screen name="snaps" options={{title:'Snaps',tabBarIcon:({color})=><Text style={{color}}>◌</Text>}}/>
  <Tabs.Screen name="profile" options={{title:'Profile',tabBarIcon:({color})=><Text style={{color}}>◎</Text>}}/>
 </Tabs>;
}
