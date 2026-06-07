import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ScrollView,
  Switch,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { WebView } from 'react-native-webview';

// ---------- PLACEHOLDER SUPABASE KEYS – REPLACE WITH YOUR OWN ----------
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
// ------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GRID_SPACING = 12;
const ITEM_SIZE = (width - GRID_SPACING * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

// ---------------------- CONTEXT ----------------------
const AppContext = createContext();

// ---------------------- MAIN APP ----------------------
export default function App() {
  const [session, setSession] = useState(null);
  const [apps, setApps] = useState([]);
  const [currentScreen, setCurrentScreen] = useState('home'); // home | admin | viewer | login
  const [selectedApp, setSelectedApp] = useState(null); // {url, name}
  const [isDark, setIsDark] = useState(true); // default dark mode

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch apps whenever session or screen changes
  useEffect(() => {
    if (currentScreen === 'home' || currentScreen === 'admin') {
      fetchApps();
    }
  }, [session, currentScreen]);

  const fetchApps = async () => {
    const { data, error } = await supabase
      .from('app_entries')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (data) setApps(data);
    else console.error(error);
  };

  const value = {
    session,
    apps,
    fetchApps,
    currentScreen,
    setCurrentScreen,
    selectedApp,
    setSelectedApp,
    isDark,
    setIsDark,
  };

  return (
    <AppContext.Provider value={value}>
      <SafeAreaView style={[styles.safeArea, isDark && styles.darkBg]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        {renderScreen()}
      </SafeAreaView>
    </AppContext.Provider>
  );
}

function renderScreen() {
  const { currentScreen } = useContext(AppContext);
  switch (currentScreen) {
    case 'home':
      return <HomeScreen />;
    case 'admin':
      return <AdminScreen />;
    case 'viewer':
      return <WebviewScreen />;
    case 'login':
      return <LoginScreen />;
    default:
      return <HomeScreen />;
  }
}

// ---------------------- HOME SCREEN ----------------------
function HomeScreen() {
  const { apps, isDark, setCurrentScreen, setSelectedApp, session } = useContext(AppContext);
  const [search, setSearch] = useState('');

  const filtered = apps.filter((app) =>
    app.name.toLowerCase().includes(search.toLowerCase())
  );

  const openApp = (app) => {
    setSelectedApp({ url: app.source_url, name: app.name });
    setCurrentScreen('viewer');
    // log usage (fire and forget)
    supabase.from('app_usage_logs').insert({ app_entry_id: app.id });
  };

  return (
    <View style={[styles.container, isDark && styles.darkBg]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.lightText]}>Apps</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setCurrentScreen('admin')}>
            <Text style={[styles.adminBtn, isDark && styles.lightText]}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <TextInput
        style={[styles.searchInput, isDark && styles.darkInput]}
        placeholder="Search apps..."
        placeholderTextColor={isDark ? '#aaa' : '#888'}
        value={search}
        onChangeText={setSearch}
      />

      {/* App Grid */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id.toString()}
        numColumns={COLUMN_COUNT}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ justifyContent: 'flex-start', gap: GRID_SPACING }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.appItem, isDark && styles.darkItem]}
            activeOpacity={0.7}
            onPress={() => openApp(item)}
          >
            {item.icon_url ? (
              <Image source={{ uri: item.icon_url }} style={styles.icon} />
            ) : (
              <View style={[styles.iconPlaceholder, { backgroundColor: item.theme_color || '#6C63FF' }]}>
                <Text style={styles.iconText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={[styles.appName, isDark && styles.lightText]} numberOfLines={2}>
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={[styles.emptyText, isDark && styles.lightText]}>No apps added yet. Visit admin.</Text>
        }
      />
    </View>
  );
}

// ---------------------- ADMIN SCREEN ----------------------
function AdminScreen() {
  const { apps, fetchApps, isDark, setCurrentScreen, session } = useContext(AppContext);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('');
  const [iconUrl, setIconUrl] = useState(''); // For simplicity, direct URL input

  const addApp = async () => {
    if (!name || !url) {
      Alert.alert('Error', 'Name and URL are required');
      return;
    }
    const { error } = await supabase.from('app_entries').insert({
      name,
      source_url: url,
      category,
      icon_url: iconUrl,
      is_active: true,
      sort_order: apps.length,
    });
    if (error) Alert.alert('Error', error.message);
    else {
      setName('');
      setUrl('');
      setCategory('');
      setIconUrl('');
      fetchApps();
    }
  };

  const deleteApp = async (id) => {
    const { error } = await supabase.from('app_entries').delete().eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else fetchApps();
  };

  const toggleApp = async (id, currentStatus) => {
    await supabase.from('app_entries').update({ is_active: !currentStatus }).eq('id', id);
    fetchApps();
  };

  if (!session) {
    return (
      <View style={[styles.container, isDark && styles.darkBg]}>
        <Text style={[styles.emptyText, isDark && styles.lightText]}>Please log in to access admin.</Text>
        <TouchableOpacity onPress={() => setCurrentScreen('login')}>
          <Text style={styles.link}>Go to Login</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setCurrentScreen('home')}>
          <Text style={styles.link}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.darkBg]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setCurrentScreen('home')}>
          <Text style={[styles.backBtn, isDark && styles.lightText]}>← Home</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.lightText]}>Admin</Text>
      </View>

      {/* Add new app form */}
      <ScrollView style={styles.adminForm}>
        <TextInput
          style={[styles.input, isDark && styles.darkInput]}
          placeholder="App Name"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[styles.input, isDark && styles.darkInput]}
          placeholder="URL (https://...)"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TextInput
          style={[styles.input, isDark && styles.darkInput]}
          placeholder="Category (optional)"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={category}
          onChangeText={setCategory}
        />
        <TextInput
          style={[styles.input, isDark && styles.darkInput]}
          placeholder="Icon URL (optional)"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={iconUrl}
          onChangeText={setIconUrl}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addApp}>
          <Text style={styles.addBtnText}>Add App</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Existing apps list */}
      <ScrollView style={{ flex: 1, marginTop: 10 }}>
        {apps.map((app) => (
          <View key={app.id} style={[styles.appRow, isDark && styles.darkRow]}>
            <View style={{ flex: 1 }}>
              <Text style={[isDark && styles.lightText]}>{app.name}</Text>
              <Text style={[styles.smallText, isDark && styles.lightText]} numberOfLines={1}>{app.source_url}</Text>
            </View>
            <Switch
              value={app.is_active}
              onValueChange={() => toggleApp(app.id, app.is_active)}
            />
            <TouchableOpacity onPress={() => deleteApp(app.id)} style={{ marginLeft: 10 }}>
              <Text style={{ color: 'red' }}>🗑️</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------- WEBVIEW SCREEN ----------------------
function WebviewScreen() {
  const { selectedApp, setCurrentScreen, isDark } = useContext(AppContext);
  if (!selectedApp) {
    setCurrentScreen('home');
    return null;
  }
  return (
    <View style={styles.webviewContainer}>
      <View style={[styles.webviewHeader, isDark && styles.darkItem]}>
        <TouchableOpacity onPress={() => setCurrentScreen('home')}>
          <Text style={[styles.backBtn, isDark && styles.lightText]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.lightText, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {selectedApp.name}
        </Text>
        <TouchableOpacity onPress={() => setCurrentScreen('home')}>
          <Text style={[styles.adminBtn, isDark && styles.lightText]}>🏠</Text>
        </TouchableOpacity>
      </View>
      <WebView
        source={{ uri: selectedApp.url }}
        style={styles.webview}
        startInLoadingState
        renderLoading={() => (
          <ActivityIndicator size="large" color="#6C63FF" style={styles.loader} />
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.warn('WebView error: ', nativeEvent);
          Alert.alert('Error', 'Failed to load the page');
        }}
      />
    </View>
  );
}

// ---------------------- LOGIN SCREEN ----------------------
function LoginScreen() {
  const { setCurrentScreen, isDark } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert('Login failed', error.message);
    else {
      setCurrentScreen('admin'); // go back to admin
    }
  };

  return (
    <View style={[styles.container, isDark && styles.darkBg, { justifyContent: 'center' }]}>
      <Text style={[styles.title, isDark && styles.lightText, { textAlign: 'center', marginBottom: 30 }]}>
        Admin Login
      </Text>
      <TextInput
        style={[styles.input, isDark && styles.darkInput]}
        placeholder="Email"
        placeholderTextColor={isDark ? '#aaa' : '#888'}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={[styles.input, isDark && styles.darkInput]}
        placeholder="Password"
        placeholderTextColor={isDark ? '#aaa' : '#888'}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.addBtn} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>Log In</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setCurrentScreen('admin')}>
        <Text style={[styles.link, { textAlign: 'center', marginTop: 20 }]}>Back to Admin (requires login)</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------- STYLES ----------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  darkBg: {
    backgroundColor: '#1A1A2E',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#16213E',
  },
  lightText: {
    color: '#F0F0F0',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  adminBtn: {
    fontSize: 22,
    padding: 4,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  darkInput: {
    backgroundColor: '#16213E',
    borderColor: '#0F3460',
    color: '#F0F0F0',
  },
  grid: {
    paddingBottom: 20,
  },
  appItem: {
    width: ITEM_SIZE,
    marginBottom: GRID_SPACING,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  darkItem: {
    backgroundColor: '#16213E',
    shadowColor: '#000',
  },
  icon: {
    width: ITEM_SIZE * 0.6,
    height: ITEM_SIZE * 0.6,
    borderRadius: 16,
    marginBottom: 8,
  },
  iconPlaceholder: {
    width: ITEM_SIZE * 0.6,
    height: ITEM_SIZE * 0.6,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconText: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  appName: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    color: '#16213E',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    color: '#888',
  },
  // Admin
  adminForm: {
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  addBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  darkRow: {
    backgroundColor: '#16213E',
  },
  smallText: {
    fontSize: 12,
    color: '#666',
  },
  link: {
    color: '#6C63FF',
    fontSize: 16,
    marginVertical: 10,
  },
  backBtn: {
    fontSize: 18,
    color: '#6C63FF',
  },
  // WebView
  webviewContainer: {
    flex: 1,
  },
  webviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  webview: {
    flex: 1,
  },
  loader: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -25,
    marginTop: -25,
  },
});
