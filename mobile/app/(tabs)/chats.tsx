import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { sendMessage, subscribeToMessages } from '../../lib/social';
import type { ChatMessage } from '../../lib/types';
const purple='#a78bfa', white='#fafafa', muted='#a1a1aa';
export default function Chats(){
 const [conversationId,setConversationId]=useState(''); const [draft,setDraft]=useState(''); const [messages,setMessages]=useState<ChatMessage[]>([]);
 useEffect(()=>{if(!conversationId)return; let alive=true;
  supabase.from('messages').select('*').eq('conversation_id',conversationId).order('created_at').then(({data,error})=>{if(error)Alert.alert('Chats',error.message);else if(alive)setMessages((data??[]) as ChatMessage[]);});
  const channel=subscribeToMessages(conversationId,m=>setMessages(old=>old.some(x=>x.id===m.id)?old:[...old,m]));
  return()=>{alive=false;supabase.removeChannel(channel);};
 },[conversationId]);
 async function send(){try{await sendMessage(conversationId,draft);setDraft('');}catch(e){Alert.alert('Message',e instanceof Error?e.message:'Unable to send');}}
 return <View style={{flex:1,backgroundColor:'#09090b',padding:18,paddingTop:58}}>
  <Text style={{color:purple,fontSize:22,fontWeight:'900',letterSpacing:4}}>MESSAGES</Text>
  <Text style={{color:muted,marginTop:12,marginBottom:8}}>Paste a conversation ID to open a chat. Conversation creation and contact discovery are next to wire up.</Text>
  <TextInput value={conversationId} onChangeText={setConversationId} placeholder="Conversation UUID" placeholderTextColor={muted} autoCapitalize="none" style={field}/>
  <FlatList style={{flex:1,marginVertical:14}} data={messages} keyExtractor={m=>m.id} renderItem={({item})=><View style={{backgroundColor:'#18181b',padding:12,borderRadius:12,marginBottom:8}}><Text style={{color:white}}>{item.body}</Text><Text style={{color:muted,fontSize:10,marginTop:5}}>{new Date(item.created_at).toLocaleTimeString()}</Text></View>}/>
  <View style={{flexDirection:'row',gap:8}}><TextInput value={draft} onChangeText={setDraft} placeholder="Write a message…" placeholderTextColor={muted} style={[field,{flex:1}]}/><Pressable onPress={send} style={{backgroundColor:purple,padding:15,borderRadius:12,justifyContent:'center'}}><Text style={{color:'#181024',fontWeight:'900'}}>SEND</Text></Pressable></View>
 </View>;
}
const field={backgroundColor:'#27272a',color:'#fafafa',padding:14,borderRadius:12} as const;
