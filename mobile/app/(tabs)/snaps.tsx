import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { createSnap } from '../../lib/social';
const purple='#a78bfa',white='#fafafa',muted='#a1a1aa';
export default function Snaps(){
 const [busy,setBusy]=useState(false);
 async function postSnap(){
  try{
   const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
   if(!permission.granted){Alert.alert('Permission needed','Allow photo library access to post a snap.');return;}
   const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images','videos'],quality:0.85});
   if(result.canceled)return;
   setBusy(true);
   const asset=result.assets[0]; const {data:{user}}=await supabase.auth.getUser();
   if(!user)throw new Error('Sign in first.');
   const response=await fetch(asset.uri); const blob=await response.blob();
   const ext=asset.fileName?.split('.').pop()??(asset.type==='video'?'mp4':'jpg');
   const path=user.id+'/'+Date.now()+'.'+ext;
   const {error}=await supabase.storage.from('snaps').upload(path,blob,{contentType:blob.type||'application/octet-stream'});
   if(error)throw error;
   const {data}=await supabase.storage.from('snaps').createSignedUrl(path,60*60*24);
   if(!data?.signedUrl)throw new Error('Could not create snap link.');
   await createSnap(data.signedUrl,asset.type==='video'?'video':'image',24);
   Alert.alert('Snap posted','Your snap is set to expire in 24 hours.');
  }catch(e){Alert.alert('Snaps',e instanceof Error?e.message:'Upload failed');}finally{setBusy(false);}
 }
 return <View style={{flex:1,backgroundColor:'#09090b',padding:22,paddingTop:58}}>
  <Text style={{color:purple,fontSize:22,fontWeight:'900',letterSpacing:4}}>PROXY SNAPS</Text>
  <Text style={{color:white,fontSize:28,fontWeight:'800',marginTop:28}}>Moments that don't stay.</Text>
  <Text style={{color:muted,lineHeight:23,marginTop:10}}>Share a photo or video with your followers. Snaps expire after 24 hours.</Text>
  <Pressable onPress={postSnap} disabled={busy} style={{backgroundColor:purple,padding:17,borderRadius:15,alignItems:'center',marginTop:28}}><Text style={{color:'#181024',fontWeight:'900'}}>{busy?'UPLOADING…':'＋  CREATE A SNAP'}</Text></Pressable>
 </View>;
}
