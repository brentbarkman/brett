import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'brett_morning_ritual_date';

export function useMorningRitual(): boolean {
  const [shouldAnimate, setShouldAnimate] = useState(false);
  useEffect(() => {
    (async () => {
      const today = new Date().toDateString();
      const lastDate = await AsyncStorage.getItem(KEY);
      if (lastDate !== today) {
        setShouldAnimate(true);
        await AsyncStorage.setItem(KEY, today);
      }
    })();
  }, []);
  return shouldAnimate;
}
