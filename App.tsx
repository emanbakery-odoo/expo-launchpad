import 'react-native-url-polyfill/auto'; // Keep this as the very first import
import React, { useState, useEffect, useRef, useCallback, useContext, createContext, useReducer } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Switch,
  Modal, Alert, ActivityIndicator, SafeAreaView, StatusBar, Platform,
  Dimensions, KeyboardAvoidingView, ScrollView, Image, RefreshControl,
  Linking, useColorScheme, Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { createClient, Session, User } from '@supabase/supabase-js';

// ==========================================
// SUPABASE CONFIG — EDIT ONLY THESE 2 LINES
// ==========================================
const SUPABASE_URL = 'https://gupthfushhukeytkturk.supabase.co'; // <-- paste your Supabase URL here
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1cHRoZnVzaGh1a2V5dGt0dXJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4Mjg5ODcsImV4cCI6MjA5NjQwNDk4N30.sqFK00zoyaS4c5AkUPttipVcl41TcGANmswYf1r18AA';         // <-- paste your anon/public key here

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ==========================
// TYPES
// ==========================
type ThemeMode = 'light' | 'dark';
type OpenMode = 'embedded' | 'external' | 'inapp';

type AppEntry = {
  id: string;
  name: string;
  icon_url?: string;
  source_url: string;
  splash_image_url?: string;
  category_id?: string | null;
  theme_color?: string;
  status: 'active' | 'inactive';
  open_mode: OpenMode;
  show_top_bar: boolean;
  show_bottom_nav: boolean;
  allow_back_nav: boolean;
  pull_to_refresh: boolean;
  cache_policy: string;
  user_agent_override?: string;
  fullscreen: boolean;
  allowed_domains?: string[] | null;
  external_link_rules: 'block' | 'allow' | 'ask';
  download_handling: 'internal' | 'external' | 'block';
  sort_order: number;
};

type Category = {
  id: string;
  name: string;
  sort_order: number;
};

type Settings = {
  id: string;
  app_name: string;
  branding_logo_url?: string;
  default_theme: ThemeMode | 'system';
  default_launch_mode: OpenMode;
  default_pin_required: boolean;
  kiosk_mode_enabled: boolean;
  maintenance_mode: boolean;
  idle_timeout_seconds?: number;
  startup_app_id?: string | null;
  admin_pin_hash?: string;
};

type ScreenName =
  | 'launcher'
  | 'viewer'
  | 'admin'
  | 'form'
  | 'settings'
  | 'pin'
  | 'login';

type AppState = {
  screen: ScreenName;
  prevScreen?: ScreenName;
  apps: AppEntry[];
  categories: Category[];
  settings: Settings | null;
  favorites: string[];
  recent: string[];
  search: string;
  selectedCategory: string | 'all';
  selectedApp: AppEntry | null;
  theme: ThemeMode;
  isAdmin: boolean;
  pinAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  user: User | null;
};

// ==========================
// HELPERS
// ==========================
function getPalette(theme: ThemeMode) {
  const d = theme === 'dark';
  return {
    bg: d ? '#0B0C10' : '#F7F8FA',
    surface: d ? '#16171D' : '#FFFFFF',
    elevated: d ? '#1E1F26' : '#FFFFFF',
    text: d ? '#F1F2F6' : '#0D0E12',
    textSecondary: d ? '#8B90A7' : '#5A6078',
    primary: '#4F6EF7',
    primaryLight: '#8AA4FF',
    border: d ? '#2A2C35' : '#E3E5EC',
    danger: '#FF4757',
    success: '#2ED573',
    overlay: d ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.45)',
    placeholder: d ? '#4A4D5A' : '#A5AAB8',
  };
}

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function b64ToArrayBuffer(base64: string): ArrayBuffer {
  const dec = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = dec.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = dec.charCodeAt(i);
  return bytes.buffer;
}

async function uploadIconFromUri(uri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const buf = b64ToArrayBuffer(base64);
    const path = `public/icons/${Date.now()}.png`;
    const { error } = await supabase.storage.from('app-assets').upload(path, buf, {
      contentType: 'image/png',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from('app-assets').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e: any) {
    Alert.alert('Upload failed', e?.message || 'Unknown error');
    return null;
  }
}

async function fetchApps(dispatch: React.Dispatch<any>) {
  const { data, error } = await supabase
    .from('app_entries')
    .select('*')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (!error) dispatch({ type: 'SET_APPS', apps: data || [] });
}

async function fetchCategories(dispatch: React.Dispatch<any>) {
  const { data, error } = await supabase.from('categories').select('*').is('deleted_at', null).order('sort_order', { ascending: true });
  if (!error) dispatch({ type: 'SET_CATEGORIES', categories: data || [] });
}

async function fetchSettings(dispatch: React.Dispatch<any>) {
  const { data, error } = await supabase.from('settings').select('*').maybeSingle();
  if (!error && data) dispatch({ type: 'SET_SETTINGS', settings: data });
}

async function fetchFavorites(dispatch: React.Dispatch<any>, userId: string) {
  const { data } = await supabase.from('favorites').select('app_id').eq('user_id', userId);
  dispatch({ type: 'SET_FAVORITES', favorites: data?.map((f) => f.app_id) || [] });
}

async function logAppOpen(appId: string, userId?: string) {
  const deviceInfo = `${Platform.OS} ${Platform.Version || ''}`;
  await supabase.from('app_usage_logs').insert({ app_id: appId, user_id: userId || null, device_info: deviceInfo });
}

// ==========================
// REDUCER
// ==========================
const initialState: AppState = {
  screen: 'launcher',
  apps: [],
  categories: [],
  settings: null,
  favorites: [],
  recent: [],
  search: '',
  selectedCategory: 'all',
  selectedApp: null,
  theme: 'light',
  isAdmin: false,
  pinAuthenticated: false,
  loading: true,
  error: null,
  user: null,
};

function reducer(state: AppState, action: any): AppState {
  switch (action.type) {
    case 'SET_APPS': return { ...state, apps: action.apps };
    case 'SET_CATEGORIES': return { ...state, categories: action.categories };
    case 'SET_SETTINGS': return { ...state, settings: action.settings };
    case 'SET_FAVORITES': return { ...state, favorites: action.favorites };
    case 'ADD_RECENT': {
      const rec = [action.id, ...state.recent.filter((x: string) => x !== action.id)].slice(0, 12);
      return { ...state, recent: rec };
    }
    case 'SET_SEARCH': return { ...state, search: action.search };
    case 'SET_CATEGORY': return { ...state, selectedCategory: action.category };
    case 'SELECT_APP': return { ...state, selectedApp: action.app };
    case 'SET_THEME': return { ...state, theme: action.theme };
    case 'SET_ADMIN': return { ...state, isAdmin: action.isAdmin };
    case 'SET_PIN_AUTH': return { ...state, pinAuthenticated: action.value };
    case 'SET_LOADING': return { ...state, loading: action.loading };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'SET_USER': return { ...state, user: action.user };
    case 'GO': return { ...state, prevScreen: action.prevScreen || state.screen, screen: action.screen };
    case 'GO_BACK': return { ...state, screen: state.prevScreen || 'launcher', prevScreen: undefined };
    default: return state;
  }
}

// ==========================
// CONTEXT
// ==========================
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<any>;
  go: (s: ScreenName, params?: any) => void;
  back: () => void;
} | null>(null);

function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppContext');
  return ctx;
}

// ==========================
// REUSABLE COMPONENTS
// ==========================
function ThemedText({ children, style, secondary, bold, center }: any) {
  const { state } = useApp();
  const p = getPalette(state.theme);
  return (
    <Text
      style={[
        { color: secondary ? p.textSecondary : p.text, fontWeight: bold ? '700' : '400' },
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

function ThemedView({ children, style }: any) {
  const { state } = useApp();
  const p = getPalette(state.theme);
  return <View style={[{ backgroundColor: p.bg }, style]}>{children}</View>;
}

function Surface({ children, style }: any) {
  const { state } = useApp();
  const p = getPalette(state.theme);
  return (
    <View style={[{ backgroundColor: p.surface, borderRadius: 16, borderWidth: 1, borderColor: p.border }, style]}>
      {children}
    </View>
  );
}

function PrimaryButton({ title, onPress, disabled, small, danger }: any) {
  const { state } = useApp();
  const p = getPalette(state.theme);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{
        backgroundColor: danger ? p.danger : p.primary,
        opacity: disabled ? 0.5 : 1,
        paddingVertical: small ? 8 : 14,
        paddingHorizontal: small ? 14 : 20,
        borderRadius: 12,
        alignItems: 'center',
      }}
    >
      <ThemedText bold style={{ color: '#fff' }}>{title}</ThemedText>
    </TouchableOpacity>
  );
}

// ==========================
// PIN SCREEN
// ==========================
function PinScreen() {
  const { state, dispatch, go } = useApp();
  const p = getPalette(state.theme);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  async function checkPin() {
    const saved = await SecureStore.getItemAsync('admin_pin');
    if (saved && saved === pin) {
      dispatch({ type: 'SET_PIN_AUTH', value: true });
      go('launcher');
    } else {
      setError(true);
      setTimeout(() => setError(false), 800);
      setPin('');
    }
  }

  function press(n: string) {
    if (pin.length < 6) {
      const next = pin + n;
      setPin(next);
      if (next.length === 6) {
        setTimeout(() => checkPin(), 200);
      }
    }
  }

  function backspace() {
    setPin((prev) => prev.slice(0, -1));
  }

  return (
    <ThemedView style={[styles.fill, { justifyContent: 'center', padding: 24 }]}>
      <ThemedText bold style={{ fontSize: 22, marginBottom: 8, textAlign: 'center' }}>Enter PIN</ThemedText>
      <ThemedText secondary style={{ textAlign: 'center', marginBottom: 24 }}>
        {state.settings?.kiosk_mode_enabled ? 'Kiosk mode is enabled' : 'Admin access protected'}
      </ThemedText>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 32 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: i < pin.length ? p.primary : p.border,
              transform: [{ scale: error && i < pin.length ? 1.2 : 1 }],
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map((key) => {
          const isAction = key === 'C' || key === '⌫';
          return (
            <TouchableOpacity
              key={key}
              onPress={() => {
                if (key === 'C') setPin('');
                else if (key === '⌫') backspace();
                else press(key);
              }}
              style={{
                width: (Dimensions.get('window').width - 96) / 3,
                height: 64,
                borderRadius: 16,
                backgroundColor: isAction ? p.surface : p.elevated,
                borderWidth: 1,
                borderColor: p.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ThemedText bold style={{ fontSize: 22, color: isAction ? p.primary : p.text }}>{key}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ height: 20 }} />
      <PrimaryButton title="Use Admin Login" small onPress={() => go('login')} />
    </ThemedView>
  );
}

// ==========================
// LOGIN SCREEN
// ==========================
function LoginScreen() {
  const { dispatch, go } = useApp();
  const p = getPalette('light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      Alert.alert('Login failed', error.message);
    } else if (data.user) {
      dispatch({ type: 'SET_USER', user: data.user });
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      const isAdmin = prof?.role === 'admin';
      dispatch({ type: 'SET_ADMIN', isAdmin });
      await fetchFavorites(dispatch, data.user.id);
      dispatch({ type: 'SET_PIN_AUTH', value: isAdmin });
      go('launcher');
    }
    setLoading(false);
  }

  return (
    <ThemedView style={[styles.fill, { justifyContent: 'center', padding: 24 }]}>
      <Text style={{ color: p.text, fontSize: 24, fontWeight: '700', marginBottom: 24 }}>Admin Login</Text>
      <TextInput
        placeholder="Email"
        placeholderTextColor={p.placeholder}
        style={[styles.input, { borderColor: p.border, color: p.text, backgroundColor: p.surface }]}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        placeholderTextColor={p.placeholder}
        style={[styles.input, { borderColor: p.border, color: p.text, backgroundColor: p.surface }]}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <PrimaryButton title="Sign In" disabled={!email || !password || loading} onPress={signIn} />
      {loading && <ActivityIndicator style={{ marginTop: 16 }} color={p.primary} />}
      <TouchableOpacity onPress={() => go('launcher')} style={{ marginTop: 16 }}>
        <ThemedText secondary center>Back to Launcher</ThemedText>
      </TouchableOpacity>
    </ThemedView>
  );
}

// ==========================
// LAUNCHER SCREEN
// ==========================
function LauncherScreen() {
  const { state, dispatch, go } = useApp();
  const p = getPalette(state.theme);
  const [menuApp, setMenuApp] = useState<AppEntry | null>(null);

  const filtered = state.apps
    .filter((a) => {
      const matchesSearch = a.name.toLowerCase().includes(state.search.toLowerCase());
      const matchesCat = state.selectedCategory === 'all' || a.category_id === state.selectedCategory;
      return matchesSearch && matchesCat;
    })
    .sort((a, b) => {
      const aFav = state.favorites.includes(a.id) ? 1 : 0;
      const bFav = state.favorites.includes(b.id) ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

  async function toggleFavorite(appId: string) {
    if (!state.user) {
      Alert.alert('Sign in required', 'Please log in to pin favorites.');
      return;
    }
    const isFav = state.favorites.includes(appId);
    if (isFav) {
      await supabase.from('favorites').delete().eq('user_id', state.user.id).eq('app_id', appId);
      dispatch({ type: 'SET_FAVORITES', favorites: state.favorites.filter((id) => id !== appId) });
    } else {
      await supabase.from('favorites').insert({ user_id: state.user.id, app_id: appId });
      dispatch({ type: 'SET_FAVORITES', favorites: [...state.favorites, appId] });
    }
  }

  function openApp(app: AppEntry) {
    if (app.open_mode === 'external') {
      Linking.openURL(app.source_url);
      return;
    }
    dispatch({ type: 'SELECT_APP', app });
    dispatch({ type: 'ADD_RECENT', id: app.id });
    logAppOpen(app.id, state.user?.id);
    go('viewer');
  }

  return (
    <ThemedView style={styles.fill}>
      <StatusBar barStyle={state.theme === 'dark' ? 'light-content' : 'dark-content'} />
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <ThemedText bold style={{ fontSize: 24, flex: 1 }}>
            {state.settings?.app_name || 'Apps'}
          </ThemedText>
          <TouchableOpacity onPress={() => go('settings')} style={{ padding: 8 }}>
            <ThemedText style={{ fontSize: 22 }}>⚙️</ThemedText>
          </TouchableOpacity>
          {state.isAdmin && (
            <TouchableOpacity onPress={() => go('admin')} style={{ padding: 8 }}>
              <ThemedText style={{ fontSize: 22 }}>🔒</ThemedText>
            </TouchableOpacity>
          )}
        </View>
        <Surface style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}>
          <ThemedText secondary style={{ marginRight: 8, fontSize: 18 }}>🔎</ThemedText>
          <TextInput
            value={state.search}
            onChangeText={(t) => dispatch({ type: 'SET_SEARCH', search: t })}
            placeholder="Search apps"
            placeholderTextColor={p.placeholder}
            style={{ flex: 1, color: p.text, fontSize: 16 }}
          />
          {state.search.length > 0 && (
            <TouchableOpacity onPress={() => dispatch({ type: 'SET_SEARCH', search: '' })}>
              <ThemedText secondary>✕</ThemedText>
            </TouchableOpacity>
          )}
        </Surface>
      </View>

      {/* Categories */}
      <View style={{ paddingLeft: 16, marginBottom: 8 }}>
        <FlatList
          horizontal
          data={[{ id: 'all', name: 'All', sort_order: -1 }, ...state.categories]}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = state.selectedCategory === item.id;
            return (
              <TouchableOpacity
                onPress={() => dispatch({ type: 'SET_CATEGORY', category: item.id })}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  marginRight: 8,
                  backgroundColor: active ? p.primary : p.surface,
                  borderWidth: 1,
                  borderColor: p.border,
                }}
              >
                <ThemedText bold style={{ color: active ? '#fff' : p.text, fontSize: 13 }}>{item.name}</ThemedText>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Grid */}
      <FlatList
        data={filtered}
        numColumns={4}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ThemedText secondary style={{ fontSize: 16 }}>No apps found</ThemedText>
          </View>
        }
        renderItem={({ item }) => {
          const isFav = state.favorites.includes(item.id);
          return (
            <TouchableOpacity
              onPress={() => openApp(item)}
              onLongPress={() => setMenuApp(item)}
              activeOpacity={0.7}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 14, maxWidth: '25%' }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 18,
                  backgroundColor: item.theme_color ? item.theme_color + '22' : p.surface,
                  borderWidth: 1,
                  borderColor: p.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {item.icon_url ? (
                  <Image source={{ uri: item.icon_url }} style={{ width: 64, height: 64, borderRadius: 18 }} resizeMode="cover" />
                ) : (
                  <ThemedText bold style={{ fontSize: 24 }}>{item.name.charAt(0).toUpperCase()}</ThemedText>
                )}
              </View>
              <ThemedText numberOfLines={2} style={{ marginTop: 8, fontSize: 12, textAlign: 'center', width: 72 }}>
                {item.name}
              </ThemedText>
              {isFav && (
                <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: p.primary, borderRadius: 6, width: 12, height: 12 }} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* Long-press menu */}
      <Modal visible={!!menuApp} transparent animationType="fade" onRequestClose={() => setMenuApp(null)}>
        <TouchableWithoutFeedback onPress={() => setMenuApp(null)}>
          <View style={[styles.fill, { backgroundColor: p.overlay, justifyContent: 'center', padding: 24 }]}>
            <TouchableWithoutFeedback>
              <Surface style={{ padding: 20, gap: 8 }}>
                <ThemedText bold style={{ fontSize: 18, marginBottom: 6 }}>{menuApp?.name}</ThemedText>
                <PrimaryButton small title={state.favorites.includes(menuApp?.id || '') ? 'Unpin Favorite' : 'Pin Favorite'} onPress={() => { if (menuApp) toggleFavorite(menuApp.id); setMenuApp(null); }} />
                {state.isAdmin && (
                  <>
                    <PrimaryButton small title="Edit" onPress={() => { if (menuApp) { dispatch({ type: 'SELECT_APP', app: menuApp }); go('form'); } setMenuApp(null); }} />
                    <PrimaryButton small danger title="Delete" onPress={async () => {
                      if (!menuApp) return;
                      Alert.alert('Delete?', `Remove ${menuApp.name}?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: async () => {
                          await supabase.from('app_entries').update({ status: 'inactive', deleted_at: new Date().toISOString() }).eq('id', menuApp.id);
                          fetchApps(dispatch);
                          setMenuApp(null);
                        }}
                      ]);
                    }} />
                  </>
                )}
                <PrimaryButton small title="Close" onPress={() => setMenuApp(null)} />
              </Surface>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </ThemedView>
  );
}

// ==========================
// VIEWER SCREEN
// ==========================
function ViewerScreen() {
  const { state, dispatch, back } = useApp();
  const p = getPalette(state.theme);
  const app = state.selectedApp;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webRef = useRef<WebView>(null);

  if (!app) return null;

  function handleNav(navState: WebViewNavigation) {
    setCanGoBack(navState.canGoBack);
    const url = navState.url;
    if (!url) return true;
    // External schemes
    const externalSchemes = ['tel:', 'mailto:', 'whatsapp://', 'maps:', 'geo:', 'sms:'];
    if (externalSchemes.some((s) => url.startsWith(s))) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    if (app.open_mode === 'inapp' && url !== app.source_url && (url.startsWith('http://') || url.startsWith('https://'))) {
      // In-app browser mode: open external domains in system browser if not allowed
      const allowed = app.allowed_domains || [];
      const domain = new URL(url).hostname;
      if (allowed.length > 0 && !allowed.some((d) => domain.includes(d))) {
        Linking.openURL(url);
        return false;
      }
    }
    return true;
  }

  return (
    <ThemedView style={styles.fill}>
      {app.show_top_bar && (
        <Surface style={{ borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 0, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => { if (canGoBack && webRef.current) webRef.current.goBack(); else back(); }}>
            <ThemedText style={{ fontSize: 22 }}>←</ThemedText>
          </TouchableOpacity>
          <ThemedText numberOfLines={1} bold style={{ flex: 1, fontSize: 16 }}>{app.name}</ThemedText>
          <TouchableOpacity onPress={() => { setLoading(true); setError(false); webRef.current?.reload(); }}>
            <ThemedText style={{ fontSize: 20 }}>↻</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={back}>
            <ThemedText style={{ fontSize: 20 }}>✕</ThemedText>
          </TouchableOpacity>
        </Surface>
      )}
      {error ? (
        <View style={[styles.fill, { justifyContent: 'center', padding: 24 }]}>
          <ThemedText bold center style={{ fontSize: 18, marginBottom: 12 }}>Unable to load app</ThemedText>
          <ThemedText secondary center style={{ marginBottom: 24 }}>Check your connection or the URL.</ThemedText>
          <PrimaryButton title="Retry" onPress={() => { setError(false); setLoading(true); webRef.current?.reload(); }} />
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: app.source_url }}
          userAgent={app.user_agent_override || undefined}
          allowsBackForwardNavigationGestures={app.allow_back_nav}
          pullToRefreshEnabled={app.pull_to_refresh}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          onShouldStartLoadWithRequest={handleNav}
          style={[styles.fill, { backgroundColor: p.bg }]}
        />
      )}
      {loading && !error && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={p.primary} />
          <ThemedText secondary style={{ marginTop: 12 }}>Loading {app.name}…</ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

// ==========================
// ADMIN SCREEN
// ==========================
function AdminScreen() {
  const { state, dispatch, go } = useApp();
  const [tab, setTab] = useState<'apps' | 'categories'>('apps');

  async function move(appId: string, dir: -1 | 1) {
    const idx = state.apps.findIndex((a) => a.id === appId);
    if (idx < 0) return;
    const newOrder = (state.apps[idx].sort_order || 0) + dir;
    await supabase.from('app_entries').update({ sort_order: newOrder }).eq('id', appId);
    fetchApps(dispatch);
  }

  return (
    <ThemedView style={styles.fill}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
        <TouchableOpacity onPress={() => go('launcher')}><ThemedText style={{ fontSize: 22 }}>←</ThemedText></TouchableOpacity>
        <ThemedText bold style={{ fontSize: 20, marginLeft: 12, flex: 1 }}>Admin</ThemedText>
        <TouchableOpacity onPress={() => { dispatch({ type: 'SELECT_APP', app: null }); go('form'); }}>
          <ThemedText style={{ fontSize: 28, color: getPalette(state.theme).primary }}>＋</ThemedText>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 }}>
        {(['apps','categories'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={{ marginRight: 16, paddingBottom: 6, borderBottomWidth: tab === t ? 2 : 0, borderColor: getPalette(state.theme).primary }}>
            <ThemedText bold style={{ color: tab === t ? getPalette(state.theme).primary : getPalette(state.theme).textSecondary, textTransform: 'capitalize' }}>{t}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'apps' ? (
        <FlatList
          data={state.apps}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Surface style={{ flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10 }}>
              {item.icon_url ? (
                <Image source={{ uri: item.icon_url }} style={{ width: 44, height: 44, borderRadius: 10, marginRight: 12 }} />
              ) : (
                <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: getPalette(state.theme).border, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <ThemedText bold>{item.name.charAt(0)}</ThemedText>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <ThemedText bold numberOfLines={1}>{item.name}</ThemedText>
                <ThemedText secondary numberOfLines={1} style={{ fontSize: 12 }}>{item.source_url}</ThemedText>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity onPress={() => move(item.id, -1)}><ThemedText>▲</ThemedText></TouchableOpacity>
                <TouchableOpacity onPress={() => move(item.id, 1)}><ThemedText>▼</ThemedText></TouchableOpacity>
                <TouchableOpacity onPress={() => { dispatch({ type: 'SELECT_APP', app: item }); go('form'); }}><ThemedText style={{ color: getPalette(state.theme).primary }}>Edit</ThemedText></TouchableOpacity>
              </View>
            </Surface>
          )}
        />
      ) : (
        <CategoryManager />
      )}
    </ThemedView>
  );
}

function CategoryManager() {
  const { state, dispatch } = useApp();
  const [name, setName] = useState('');

  async function add() {
    if (!name.trim()) return;
    await supabase.from('categories').insert({ name: name.trim(), sort_order: state.categories.length });
    setName('');
    fetchCategories(dispatch);
  }

  async function remove(id: string) {
    await supabase.from('categories').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    fetchCategories(dispatch);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New category"
          placeholderTextColor={getPalette(state.theme).placeholder}
          style={[styles.input, { flex: 1, color: getPalette(state.theme).text, backgroundColor: getPalette(state.theme).surface, borderColor: getPalette(state.theme).border }]}
        />
        <PrimaryButton small title="Add" onPress={add} />
      </View>
      {state.categories.map((cat) => (
        <Surface key={cat.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8 }}>
          <ThemedText style={{ flex: 1 }}>{cat.name}</ThemedText>
          <TouchableOpacity onPress={() => remove(cat.id)}><ThemedText style={{ color: getPalette(state.theme).danger }}>Delete</ThemedText></TouchableOpacity>
        </Surface>
      ))}
    </ScrollView>
  );
}

// ==========================
// APP FORM SCREEN
// ==========================
function AppFormScreen() {
  const { state, dispatch, go } = useApp();
  const app = state.selectedApp;
  const p = getPalette(state.theme);
  const isEdit = !!app;

  const [name, setName] = useState(app?.name || '');
  const [url, setUrl] = useState(app?.source_url || '');
  const [iconUrl, setIconUrl] = useState(app?.icon_url || '');
  const [themeColor, setThemeColor] = useState(app?.theme_color || '');
  const [catId, setCatId] = useState(app?.category_id || 'all');
  const [openMode, setOpenMode] = useState<OpenMode>(app?.open_mode || 'embedded');
  const [showTop, setShowTop] = useState(app?.show_top_bar ?? true);
  const [allowBack, setAllowBack] = useState(app?.allow_back_nav ?? true);
  const [pullRefresh, setPullRefresh] = useState(app?.pull_to_refresh ?? true);
  const [fullscreen, setFullscreen] = useState(app?.fullscreen ?? false);
  const [status, setStatus] = useState<'active' | 'inactive'>(app?.status || 'active');
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  async function pickAndUpload() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) {
      const publicUrl = await uploadIconFromUri(result.assets[0].uri);
      if (publicUrl) setIconUrl(publicUrl);
    }
  }

  async function save() {
    if (!name.trim() || !isValidHttpUrl(url)) {
      Alert.alert('Validation', 'Enter a valid name and URL');
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      source_url: url.trim(),
      icon_url: iconUrl.trim() || null,
      theme_color: themeColor.trim() || null,
      category_id: catId === 'all' ? null : catId,
      open_mode: openMode,
      show_top_bar: showTop,
      allow_back_nav: allowBack,
      pull_to_refresh: pullRefresh,
      fullscreen,
      status,
      sort_order: app?.sort_order ?? state.apps.length,
    };
    if (isEdit && app) {
      await supabase.from('app_entries').update(payload).eq('id', app.id);
    } else {
      await supabase.from('app_entries').insert(payload);
    }
    await fetchApps(dispatch);
    setSaving(false);
    go('admin');
  }

  return (
    <ThemedView style={styles.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => go('admin')}><ThemedText style={{ fontSize: 22 }}>←</ThemedText></TouchableOpacity>
            <ThemedText bold style={{ fontSize: 20, marginLeft: 12 }}>{isEdit ? 'Edit App' : 'Add App'}</ThemedText>
          </View>

          <ThemedText style={{ marginBottom: 6 }}>App Name</ThemedText>
          <TextInput value={name} onChangeText={setName} style={[styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }]} placeholderTextColor={p.placeholder} />

          <ThemedText style={{ marginBottom: 6, marginTop: 12 }}>Source URL</ThemedText>
          <TextInput value={url} onChangeText={setUrl} style={[styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }]} placeholder="https://…" placeholderTextColor={p.placeholder} autoCapitalize="none" />

          <ThemedText style={{ marginBottom: 6, marginTop: 12 }}>Icon URL (or upload)</ThemedText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={iconUrl} onChangeText={setIconUrl} style={[styles.input, { flex: 1, color: p.text, backgroundColor: p.surface, borderColor: p.border }]} placeholderTextColor={p.placeholder} />
            <PrimaryButton small title="Upload" onPress={pickAndUpload} />
          </View>

          <ThemedText style={{ marginBottom: 6, marginTop: 12 }}>Theme Color (hex optional)</ThemedText>
          <TextInput value={themeColor} onChangeText={setThemeColor} style={[styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }]} placeholder="#4F6EF7" placeholderTextColor={p.placeholder} />

          <ThemedText style={{ marginBottom: 6, marginTop: 12 }}>Category</ThemedText>
          <TouchableOpacity onPress={() => setShowPicker(true)} style={[styles.input, { justifyContent: 'center', backgroundColor: p.surface, borderColor: p.border }]}>
            <ThemedText>{state.categories.find((c) => c.id === catId)?.name || 'None'}</ThemedText>
          </TouchableOpacity>

          <ThemedText style={{ marginBottom: 6, marginTop: 12 }}>Open Mode</ThemedText>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {(['embedded','external','inapp'] as OpenMode[]).map((m) => (
              <TouchableOpacity key={m} onPress={() => setOpenMode(m)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: openMode === m ? p.primary : p.surface, borderWidth: 1, borderColor: p.border, alignItems: 'center' }}>
                <ThemedText bold style={{ color: openMode === m ? '#fff' : p.text, textTransform: 'capitalize', fontSize: 12 }}>{m}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <ThemedText>Show top bar</ThemedText>
            <Switch value={showTop} onValueChange={setShowTop} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <ThemedText>Allow back nav</ThemedText>
            <Switch value={allowBack} onValueChange={setAllowBack} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <ThemedText>Pull to refresh</ThemedText>
            <Switch value={pullRefresh} onValueChange={setPullRefresh} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <ThemedText>Fullscreen</ThemedText>
            <Switch value={fullscreen} onValueChange={setFullscreen} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <ThemedText>Active</ThemedText>
            <Switch value={status === 'active'} onValueChange={(v) => setStatus(v ? 'active' : 'inactive')} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>

          <PrimaryButton title={isEdit ? 'Update App' : 'Add App'} onPress={save} disabled={saving} />
          {saving && <ActivityIndicator style={{ marginTop: 12 }} color={p.primary} />}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Category picker modal */}
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={[styles.fill, { backgroundColor: p.overlay, justifyContent: 'flex-end' }]}>
          <Surface style={{ padding: 16, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            <ThemedText bold style={{ marginBottom: 12 }}>Select Category</ThemedText>
            <TouchableOpacity onPress={() => { setCatId('all'); setShowPicker(false); }} style={{ paddingVertical: 10 }}>
              <ThemedText>None</ThemedText>
            </TouchableOpacity>
            {state.categories.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => { setCatId(c.id); setShowPicker(false); }} style={{ paddingVertical: 10 }}>
                <ThemedText>{c.name}</ThemedText>
              </TouchableOpacity>
            ))}
            <PrimaryButton small title="Close" onPress={() => setShowPicker(false)} />
          </Surface>
        </View>
      </Modal>
    </ThemedView>
  );
}

// ==========================
// SETTINGS SCREEN
// ==========================
function SettingsScreen() {
  const { state, dispatch, go } = useApp();
  const p = getPalette(state.theme);
  const [pin, setPin] = useState('');
  const [themeOption, setThemeOption] = useState<ThemeMode | 'system'>(state.settings?.default_theme || 'system');

  async function savePin() {
    if (pin.length < 4) { Alert.alert('PIN too short'); return; }
    await SecureStore.setItemAsync('admin_pin', pin);
    Alert.alert('PIN saved');
    setPin('');
  }

  async function updateThemeOption(opt: ThemeMode | 'system') {
    setThemeOption(opt);
    await supabase.from('settings').update({ default_theme: opt }).eq('id', state.settings?.id);
    const t = opt === 'system' ? (useColorScheme() as ThemeMode || 'light') : opt;
    dispatch({ type: 'SET_THEME', theme: t });
    fetchSettings(dispatch);
  }

  async function toggleKiosk() {
    const next = !state.settings?.kiosk_mode_enabled;
    await supabase.from('settings').update({ kiosk_mode_enabled: next }).eq('id', state.settings?.id);
    fetchSettings(dispatch);
  }

  async function toggleMaintenance() {
    const next = !state.settings?.maintenance_mode;
    await supabase.from('settings').update({ maintenance_mode: next }).eq('id', state.settings?.id);
    fetchSettings(dispatch);
  }

  async function logout() {
    await supabase.auth.signOut();
    dispatch({ type: 'SET_USER', user: null });
    dispatch({ type: 'SET_ADMIN', isAdmin: false });
    dispatch({ type: 'SET_PIN_AUTH', value: false });
    go('launcher');
  }

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity onPress={() => go('launcher')}><ThemedText style={{ fontSize: 22 }}>←</ThemedText></TouchableOpacity>
          <ThemedText bold style={{ fontSize: 20, marginLeft: 12 }}>Settings</ThemedText>
        </View>

        <ThemedText bold style={{ marginBottom: 8 }}>Appearance</ThemedText>
        <Surface style={{ padding: 12, marginBottom: 16 }}>
          {(['light','dark','system'] as const).map((opt) => (
            <TouchableOpacity key={opt} onPress={() => updateThemeOption(opt as any)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
              <ThemedText style={{ textTransform: 'capitalize' }}>{opt}</ThemedText>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: p.primary, alignItems: 'center', justifyContent: 'center' }}>
                {themeOption === opt && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.primary }} />}
              </View>
            </TouchableOpacity>
          ))}
        </Surface>

        <ThemedText bold style={{ marginBottom: 8 }}>Security</ThemedText>
        <Surface style={{ padding: 12, marginBottom: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <ThemedText>Kiosk mode</ThemedText>
            <Switch value={!!state.settings?.kiosk_mode_enabled} onValueChange={toggleKiosk} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <ThemedText>Maintenance mode</ThemedText>
            <Switch value={!!state.settings?.maintenance_mode} onValueChange={toggleMaintenance} trackColor={{ false: '#767577', true: p.primaryLight }} />
          </View>
          <ThemedText>Set / change PIN</ThemedText>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="4–6 digits"
            placeholderTextColor={p.placeholder}
            keyboardType="number-pad"
            maxLength={6}
            secureTextEntry
            style={[styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }]}
          />
          <PrimaryButton small title="Save PIN" onPress={savePin} />
        </Surface>

        <PrimaryButton title="Open Admin Panel" onPress={() => {
          if (state.pinAuthenticated || state.isAdmin) go('admin');
          else go('pin');
        }} />

        {state.user && (
          <TouchableOpacity onPress={logout} style={{ marginTop: 20, alignItems: 'center' }}>
            <ThemedText style={{ color: p.danger }}>Log Out</ThemedText>
          </TouchableOpacity>
        )}
      </ScrollView>
    </ThemedView>
  );
}

// ==========================
// STYLES
// ==========================
const styles = StyleSheet.create({
  fill: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});

// ==========================
// ROOT APP
// ==========================
export default function App() {
  const systemTheme = (useColorScheme() as ThemeMode) || 'light';
  const [state, dispatch] = useReducer(reducer, initialState);

  // Resolve effective theme
  const effectiveTheme: ThemeMode =
    state.settings?.default_theme === 'system' || !state.settings?.default_theme
      ? systemTheme
      : (state.settings?.default_theme as ThemeMode);

  useEffect(() => {
    dispatch({ type: 'SET_THEME', theme: effectiveTheme });
  }, [effectiveTheme, state.settings?.default_theme]);

  useEffect(() => {
    let mounted = true;
    async function init() {
      dispatch({ type: 'SET_LOADING', loading: true });
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (mounted) dispatch({ type: 'SET_USER', user });
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        const isAdmin = prof?.role === 'admin';
        if (mounted) {
          dispatch({ type: 'SET_ADMIN', isAdmin });
          dispatch({ type: 'SET_PIN_AUTH', value: isAdmin });
        }
        await fetchFavorites(dispatch, user.id);
      }
      await Promise.all([fetchApps(dispatch), fetchCategories(dispatch), fetchSettings(dispatch)]);
      dispatch({ type: 'SET_LOADING', loading: false });
    }
    init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch({ type: 'SET_USER', user: session?.user ?? null });
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const go = useCallback((screen: ScreenName, params?: any) => {
    dispatch({ type: 'GO', screen, prevScreen: params?.prevScreen });
  }, []);

  const back = useCallback(() => {
    dispatch({ type: 'GO_BACK' });
  }, []);

  if (state.loading) {
    const p = getPalette(state.theme);
    return (
      <View style={[styles.fill, { backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={p.primary} />
        <ThemedText secondary style={{ marginTop: 12 }}>Loading…</ThemedText>
      </View>
    );
  }

  return (
    <AppContext.Provider value={{ state, dispatch, go, back }}>
      <ExpoStatusBar style={state.theme === 'dark' ? 'light' : 'dark'} />
      {state.screen === 'pin' && <PinScreen />}
      {state.screen === 'login' && <LoginScreen />}
      {state.screen === 'launcher' && <LauncherScreen />}
      {state.screen === 'viewer' && <ViewerScreen />}
      {state.screen === 'admin' && <AdminScreen />}
      {state.screen === 'form' && <AppFormScreen />}
      {state.screen === 'settings' && <SettingsScreen />}
    </AppContext.Provider>
  );
}
