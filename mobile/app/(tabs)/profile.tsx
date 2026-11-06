import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
const purple='#a78bfa',white='#fafafa',muted='#a1a1aa';
export default function Profile(){
 const [email,setEmail]=useState(''); const [username,setUsername]=useState('');
 useEffect(()=>{supabase.auth.getUser().then(async({data})=>{setEmail(data.user?.email??'');if(data.user){const {data:p}=await supabase.from('profiles').select('username').eq('id',data.user.id).maybeSingle();setUsername(p?.username??'');}});},[]);
 async function logout(){const {error}=await supabase.auth.signOut();if(error)Alert.alert('Sign out',error.message);else router.replace('/sign-in');}
 return <View style={{flex:1,backgroundColor:'#09090b',padding:22,paddingTop:58}}>
  <Text style={{color:purple,fontSize:22,fontWeight:'900',letterSpacing:4}}>YOUR PROFILE</Text>
  <View style={{width:88,height:88,borderRadius:44,backgroundColor:'#27272a',alignItems:'center',justifyContent:'center',marginTop:35}}><Text style={{color:purple,fontSize:32,fontWeight:'900'}}>{(username||email||'P')[0].toUpperCase()}</Text></View>
  <Text style={{color:white,fontSize:25,fontWeight:'800',marginTop:18}}>@{username||'new_user'}</Text><Text style={{color:muted,marginTop:6}}>{email}</Text>
  <Pressable onPress={logout} style={{borderColor:'#3f3f46',borderWidth:1,padding:16,borderRadius:14,marginTop:36,alignItems:'center'}}><Text style={{color:white,fontWeight:'800'}}>SIGN OUT</Text></Pressable>
 </View>;
}
