import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LivingBackground } from '../../../src/components/LivingBackground';

export default function UpcomingScreen() {
  return (
    <View style={{ flex: 1 }}>
      <LivingBackground />
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18 }}>Upcoming</Text>
      </SafeAreaView>
    </View>
  );
}
