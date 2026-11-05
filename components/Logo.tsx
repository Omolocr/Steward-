// The Seventh-day Adventist Church emblem, shown in every header and on the sign-in screen.
import React from 'react';
import { Image, View } from 'react-native';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <Image source={require('../../assets/adventist-logo.png')} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" accessibilityLabel="Seventh-day Adventist Church" />
    </View>
  );
}
