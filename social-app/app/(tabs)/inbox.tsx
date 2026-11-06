import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
const chats=[{id:"1",name:"Mariam",message:"Hey, how are you?",time:"2m"},{id:"2",name:"Abdul",message:"That video is funny 😂",time:"15m"},{id:"3",name:"Zara",message:"Sent you a snap",time:"1h"}];
export default function Inbox(){
 const router=useRouter();
 return <View style={s.page}><Text style={s.title}>Messages</Text><Text style={s.sub}>Your conversations</Text>
 <FlatList data={chats} keyExtractor={x=>x.id} renderItem={({item})=><Pressable onPress={()=>router.push({pathname:"/chat/[id]",params:{id:item.id,name:item.name}})} style={s.row}><View style={s.avatar}><Text style={s.avatarText}>{item.name[0]}</Text></View><View style={{flex:1}}><Text style={s.name}>{item.name}</Text><Text style={s.message}>{item.message}</Text></View><Text style={s.time}>{item.time}</Text></Pressable>}/>
 </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#09090D",padding:20,paddingTop:60},title:{color:"white",fontSize:28,fontWeight:"800"},sub:{color:"#999",marginTop:6,marginBottom:18},row:{flexDirection:"row",alignItems:"center",paddingVertical:15,borderBottomWidth:1,borderColor:"#22222B",gap:12},avatar:{width:48,height:48,borderRadius:24,backgroundColor:"#533C77",alignItems:"center",justifyContent:"center"},avatarText:{color:"white",fontSize:18,fontWeight:"800"},name:{color:"white",fontWeight:"800",fontSize:15},message:{color:"#999",marginTop:4},time:{color:"#777",fontSize:11}});
