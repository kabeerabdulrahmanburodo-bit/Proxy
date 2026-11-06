import { useState } from "react";
import { View, Text, ScrollView, ImageBackground, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const stories = ["Your story", "mariam", "abdul", "zara", "daniel"];
const clips = [
  { user: "@creator_one", caption: "Little moments, big memories. ✨", image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=900", likes: "12.4K" }
];

export default function HomeScreen() {
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);
  const clip = clips[0];

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.logo}>PROXY<Text style={s.dot}>.</Text></Text>
        <View style={s.headerActions}>
          <Ionicons name="heart-outline" size={25} color="white" />
          <Ionicons name="paper-plane-outline" size={24} color="white" />
        </View>
      </View>
      <View style={s.stories}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {stories.map((name, i) => (
            <Pressable key={name} style={s.story}>
              <View style={[s.storyRing, i === 0 && s.ownRing]}>
                <View style={s.storyInner}><Ionicons name={i === 0 ? "add" : "person"} size={23} color="white" /></View>
              </View>
              <Text style={s.storyName}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ImageBackground source={{ uri: clip.image }} resizeMode="cover" style={s.video}>
        <View style={s.videoShade} />
        <View style={s.videoTop}><Text style={s.feedLabel}>FOR YOU</Text><Text style={s.feedLabel}>FOLLOWING</Text></View>
        <View style={s.videoBottom}>
          <View style={s.creator}>
            <Text style={s.creatorName}>{clip.user}</Text>
            <Text style={s.caption}>{clip.caption}</Text>
            <Pressable style={s.followBtn} onPress={() => setFollowing(!following)}>
              <Text style={s.followText}>{following ? "Following" : "Follow"}</Text>
            </Pressable>
          </View>
          <View style={s.engagement}>
            <Pressable onPress={() => setLiked(!liked)} style={s.action}><Ionicons name={liked ? "heart" : "heart-outline"} size={32} color={liked ? "#FF477E" : "white"} /><Text style={s.actionText}>{liked ? "12.5K" : clip.likes}</Text></Pressable>
            <View style={s.action}><Ionicons name="chatbubble-ellipses-outline" size={30} color="white" /><Text style={s.actionText}>Comments</Text></View>
            <View style={s.action}><Ionicons name="paper-plane-outline" size={29} color="white" /><Text style={s.actionText}>Share</Text></View>
          </View>
        </View>
        <View style={s.demo}><Text style={s.demoText}>DEMO FEED · Replace with uploaded video posts</Text></View>
      </ImageBackground>
    </View>
  );
}
const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#09090D"},header:{height:52,paddingHorizontal:18,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  logo:{color:"white",fontSize:25,fontWeight:"900",letterSpacing:2},dot:{color:"#A66BFF"},headerActions:{flexDirection:"row",gap:22},
  stories:{height:94,paddingLeft:12,borderBottomWidth:1,borderBottomColor:"#22222B"},story:{width:67,alignItems:"center",paddingTop:8},storyRing:{width:54,height:54,borderRadius:27,borderWidth:2,borderColor:"#A66BFF",alignItems:"center",justifyContent:"center"},ownRing:{borderColor:"#5D5D69",borderStyle:"dashed"},storyInner:{width:46,height:46,borderRadius:23,backgroundColor:"#292936",alignItems:"center",justifyContent:"center"},storyName:{color:"#E6E6EB",fontSize:10,marginTop:4},
  video:{flex:1,justifyContent:"space-between"},videoShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(0,0,0,0.24)"},videoTop:{flexDirection:"row",justifyContent:"center",gap:25,paddingTop:17},feedLabel:{color:"white",fontSize:13,fontWeight:"800",textShadowColor:"#000",textShadowRadius:5},
  videoBottom:{flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",paddingHorizontal:16,paddingBottom:24},creator:{flex:1,paddingRight:12},creatorName:{color:"white",fontSize:15,fontWeight:"800"},caption:{color:"white",fontSize:13,marginTop:7},followBtn:{marginTop:12,borderWidth:1,borderColor:"white",borderRadius:7,paddingHorizontal:14,paddingVertical:6,alignSelf:"flex-start"},followText:{color:"white",fontWeight:"700",fontSize:12},
  engagement:{alignItems:"center",gap:23},action:{alignItems:"center",gap:4},actionText:{color:"white",fontSize:10,fontWeight:"700"},demo:{alignSelf:"center",marginBottom:7,backgroundColor:"rgba(0,0,0,.35)",padding:5,borderRadius:4},demoText:{color:"#DDD",fontSize:9}
});
