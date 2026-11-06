import { View, Text, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
export default function Discover() {
  return <View style={s.page}>
    <Text style={s.title}>Discover</Text>
    <View style={s.search}><Ionicons name="search" color="#999" size={20}/><TextInput placeholder="Search people, sounds and videos" placeholderTextColor="#888" style={s.input}/></View>
    <Text style={s.sub}>TRENDING</Text>
    <Text style={s.note}>Explore creators and videos as the community grows.</Text>
  </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#09090D",padding:20,paddingTop:60},title:{color:"white",fontSize:28,fontWeight:"800"},search:{marginTop:20,backgroundColor:"#1B1B25",borderRadius:12,padding:13,flexDirection:"row",alignItems:"center",gap:10},input:{color:"white",flex:1},sub:{color:"#AAA",fontSize:11,fontWeight:"800",marginTop:35,letterSpacing:2},note:{color:"#888",marginTop:12}});
