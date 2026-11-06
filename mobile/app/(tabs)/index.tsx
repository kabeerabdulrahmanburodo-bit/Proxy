import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, Text, View } from 'react-native';
import { getVideoFeed } from '../../lib/social';
import type { VideoPost } from '../../lib/types';
const purple='#a78bfa', white='#fafafa', muted='#a1a1aa';
export default function Feed(){
 const [posts,setPosts]=useState<VideoPost[]>([]); const [busy,setBusy]=useState(true);
 const load=useCallback(async()=>{try{setPosts(await getVideoFeed());}catch(e){console.warn(e);}finally{setBusy(false);}},[]);
 useEffect(()=>{load();},[load]);
 return <View style={{flex:1,backgroundColor:'#09090b',paddingTop:58}}>
  <View style={{paddingHorizontal:20,paddingBottom:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
   <Text style={{color:purple,fontSize:22,fontWeight:'900',letterSpacing:4}}>PROXY</Text><Text style={{color:white,fontWeight:'700'}}>FOR YOU  ·  FOLLOWING</Text>
  </View>
  {busy?<ActivityIndicator color={purple} style={{marginTop:60}}/>:<FlatList data={posts} keyExtractor={p=>p.id} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={purple}/>} contentContainerStyle={{padding:16,gap:16}} ListEmptyComponent={<Text style={{color:muted,textAlign:'center',marginTop:80}}>Your feed is waiting. Follow creators or upload the first video.</Text>} renderItem={({item})=><View style={{backgroundColor:'#18181b',borderRadius:20,overflow:'hidden'}}>
   <View style={{height:360,backgroundColor:'#27272a',alignItems:'center',justifyContent:'center'}}>{item.thumbnail_url?<Image source={{uri:item.thumbnail_url}} style={{width:'100%',height:'100%'}} resizeMode="cover"/>:<Text style={{color:muted}}>VIDEO · Open playback screen to watch</Text>}</View>
   <View style={{padding:15}}><Text style={{color:purple,fontWeight:'800'}}>@{item.profiles?.username??'creator'}</Text><Text style={{color:white,marginTop:6}}>{item.caption??''}</Text></View>
  </View>}/>}
 </View>;
}
