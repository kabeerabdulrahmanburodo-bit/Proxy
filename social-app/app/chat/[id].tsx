import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
type Message={id:string;body:string;mine:boolean};
export default function Chat(){
 const {name}=useLocalSearchParams<{name:string}>();
 const router=useRouter();
 const [draft,setDraft]=useState("");
 const [messages,setMessages]=useState<Message[]>([{id:"welcome",body:"This is your new chat. Say hello!",mine:false}]);
 function send(){const body=draft.trim();if(!body)return;setMessages(old=>[...old,{id:String(Date.now()),body,mine:true}]);setDraft("");}
 return <View style={s.page}>
  <View style={s.header}><Pressable onPress={()=>router.back()}><Ionicons name="arrow-back" color="white" size={24}/></Pressable><Text style={s.title}>{name||"Chat"}</Text></View>
  <FlatList style={{flex:1}} data={messages} keyExtractor={m=>m.id} contentContainerStyle={{paddingVertical:16}} renderItem={({item})=><View style={[s.bubble,item.mine?s.mine:s.theirs]}><Text style={s.body}>{item.body}</Text></View>}/>
  <View style={s.compose}><TextInput value={draft} onChangeText={setDraft} placeholder="Message..." placeholderTextColor="#888" style={s.input}/><Pressable onPress={send} style={s.send}><Ionicons name="send" color="white" size={19}/></Pressable></View>
 </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#09090D",paddingTop:55,paddingHorizontal:16},header:{height:50,flexDirection:"row",alignItems:"center",gap:20,borderBottomWidth:1,borderColor:"#252530"},title:{color:"white",fontSize:18,fontWeight:"800"},bubble:{maxWidth:"80%",padding:12,borderRadius:16,marginVertical:5},mine:{backgroundColor:"#6E42A8",alignSelf:"flex-end"},theirs:{backgroundColor:"#242430",alignSelf:"flex-start"},body:{color:"white",fontSize:14},compose:{flexDirection:"row",gap:10,paddingVertical:12},input:{flex:1,backgroundColor:"#20202A",borderRadius:25,paddingHorizontal:16,color:"white"},send:{height:46,width:46,borderRadius:23,backgroundColor:"#8B54D6",alignItems:"center",justifyContent:"center"}});
