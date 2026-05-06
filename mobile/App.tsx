import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, Text, View, ActivityIndicator } from 'react-native';
import { C } from './src/colors';
import type { RootStackParamList } from './src/navigation';
import { loadServerUrl, isRailway } from './src/config';
import HomeScreen from './src/screens/HomeScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import DetailScreen from './src/screens/DetailScreen';
import PatternsScreen from './src/screens/PatternsScreen';
import ServerScreen from './src/screens/ServerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [ready, setReady] = useState(false);

  // Load persisted server URL before rendering anything
  useEffect(() => {
    loadServerUrl().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: C.bg2 },
          headerTintColor: C.text1,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          contentStyle: { backgroundColor: C.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={({ navigation }) => ({
            title: '⚾ MLB Predictor',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.navigate('Server')}
                style={{ marginRight: 4, padding: 4 }}
              >
                <Text style={{ fontSize: 20 }}>
                  {isRailway() ? '☁️' : '🏠'}
                </Text>
              </TouchableOpacity>
            ),
          })}
        />
        <Stack.Screen name="History"  component={HistoryScreen}  options={{ title: 'Prediction History' }} />
        <Stack.Screen name="Detail"   component={DetailScreen}   options={{ title: 'Prediction Detail' }} />
        <Stack.Screen name="Patterns" component={PatternsScreen} options={{ title: 'Pattern Analysis' }} />
        <Stack.Screen
          name="Server"
          component={ServerScreen}
          options={{ title: 'Server Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
