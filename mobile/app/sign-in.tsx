import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Link, router } from 'expo-router';
import { signIn, signUp } from '../lib/auth';

const bg='#09090b', card='#18181b', purple='#a78bfa', white='#fafafa', muted='#a1a1aa';
export default function SignIn() {
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [username,setUsername]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(){
    try {
      setBusy(true);
      if(register){ await signUp(email,password,username); Alert.alert('Check your email','Confirm your email address if email confirmation is enabled, then sign in.'); setRegister(false); }
      else { await signIn(email,password); router.replace('/(tabs)'); }
    } catch(e){ Alert.alert('PROXY', e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1,backgroundColor:bg,justifyContent:'center',padding:26}}>
    <Text style={{color:purple,fontSize:15,fontWeight:'900',letterSpacing:5}}>PROXY</Text>
    <Text style={{color:white,fontSize:34,fontWeight:'900',marginTop:14}}>{register?'Create your account':'Your world. In motion.'}</Text>
    <Text style={{color:muted,fontSize:15,marginTop:8,marginBottom:28}}>{register?'Join the people, stories and moments.':'Sign in to continue to your community.'}</Text>
    <View style={{backgroundColor:card,borderRadius:22,padding:18,gap:13}}>
      {register&&<TextInput value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={muted} autoCapitalize="none" style={field}/>}
      <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor={muted} autoCapitalize="none" keyboardType="email-address" style={field}/>
      <TextInput value={password} onChangeText={setPassword} placeholder="Password (min. 6 characters)" placeholderTextColor={muted} secureTextEntry style={field}/>
      <Pressable onPress={submit} disabled={busy} style={{backgroundColor:purple,padding:16,borderRadius:14,alignItems:'center',marginTop:4}}>
        <Text style={{color:'#181024',fontWeight:'900'}}>{busy?'PLEASE WAIT':register?'CREATE ACCOUNT':'SIGN IN'}</Text>
      </Pressable>
    </View>
    <Pressable onPress={()=>setRegister(!register)} style={{padding:20,alignItems:'center'}}>
      <Text style={{color:muted}}>{register?'Already have an account? ':'New to PROXY? '}<Text style={{color:purple,fontWeight:'800'}}>{register?'Sign in':'Create account'}</Text></Text>
    </Pressable>
  </KeyboardAvoidingView>;
}
const field={backgroundColor:'#27272a',color:'#fafafa',padding:15,borderRadius:12,fontSize:15} as const;
