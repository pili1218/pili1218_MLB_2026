import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { C } from './src/colors';
import type { RootStackParamList } from './src/navigation';
import HomeScreen from './src/screens/HomeScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import DetailScreen from './src/screens/DetailScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
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
        <Stack.Screen name="Home"    component={HomeScreen}    options={{ title: '⚾ MLB Predictor' }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Prediction History' }} />
        <Stack.Screen name="Detail"  component={DetailScreen}  options={{ title: 'Prediction Detail' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
