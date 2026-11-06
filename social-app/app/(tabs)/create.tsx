import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

export default function Create() {
  const [uri,setUri]=useState<string|null>(null);
  async function chooseMedia() {
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("Permission needed","Allow photo library access to select media.");return;}
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images","videos"],quality:0.9});
    if(!result.canceled) setUri(result.assets[0].uri);
  }
  async function takePhoto() {
    const permission=await ImagePicker.requestCameraPermissionsAsync();
    if(!permission.granted){Alert.alert("Permission needed","Allow camera access to take a photo.");return;}
    const result=await ImagePicker.launchCameraAsync({mediaTypes:["images","videos"],quality:0.9});
    if(!result.canceled) setUri(result.assets[0].uri);
  }
  return <View style={s.page}>
    <Text style={s.title}>Create</Text>
    {uri ? <Image source={{uri}} style={s.preview}/> : <View style={s.empty}><Ionicons name="images-outline" size={48} color="#A66BFF"/><Text style={s.hint}>Create a post, story or short video</Text></View>}
    <Pressable style={s.button} onPress={takePhoto}><Ionicons name="camera" color="white" size={20}/><Text style={s.buttonText}>Open camera</Text></Pressable>
    <Pressable style={s.button} onPress={chooseMedia}><Ionicons name="cloud-upload-outline" color="white" size={20}/><Text style={s.buttonText}>Choose from library</Text></Pressable>
    <Text style={s.small}>Media selection is ready. Uploading and publishing will be connected to your backend next.</Text>
  </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#09090D",padding:20,paddingTop:60},title:{color:"white",fontWeight:"800",fontSize:28},empty:{height:300,marginTop:25,backgroundColor:"#181820",borderRadius:18,alignItems:"center",justifyContent:"center",gap:12},hint:{color:"#CCC"},preview:{height:300,marginTop:25,borderRadius:18},button:{marginTop:15,backgroundColor:"#292038",borderRadius:12,padding:16,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:10},buttonText:{color:"white",fontWeight:"700"},small:{color:"#858591",fontSize:12,marginTop:18,lineHeight:18}});
