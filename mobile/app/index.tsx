import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useState } from 'react';

export default function Index() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSignedIn(!!data.session); setReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => subscription.unsubscribe();
  }, []);
  if (!ready) return <View style={{ flex:1, backgroundColor:'#09090b', alignItems:'center', justifyContent:'center' }}><ActivityIndicator color="#a78bfa" /></View>;
  return <Redirect href={signedIn ? '/(tabs)' : '/sign-in'} />;
}
