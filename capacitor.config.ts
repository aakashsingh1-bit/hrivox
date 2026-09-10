import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hrivox.app900',
  appName: 'HRIVOX 900',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#050812',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 0,
      backgroundColor: '#050812',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
