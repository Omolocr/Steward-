// Address of the Church Connect server. Set EXPO_PUBLIC_API_URL when you build, e.g.
//   EXPO_PUBLIC_API_URL=https://api.yourchurch.org npx expo start
// (release builds get it from eas.json: see scripts/configure-app.mjs). The fallback below only works on the Android EMULATOR,
// where 10.0.2.2 is the computer running the server. On a real phone use the computer's LAN address (http://192.168.x.x:8080) or the hosted https address.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

/** True when this build points at an address that cannot work for ordinary people (the emulator address, localhost, or plain http). */
export const API_IS_TEST_ADDRESS = /^(http:\/\/(10\.0\.2\.2|localhost|127\.|192\.168\.))/.test(API_URL) || /yourchurch\.org/.test(API_URL);
