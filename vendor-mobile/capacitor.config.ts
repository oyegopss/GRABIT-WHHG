import type { CapacitorConfig } from '@capacitor/cli';

const rawUrl = process.env.GRABIT_WEB_URL || "https://grabit.ventures";
const entryUrl = rawUrl.replace(/\/$/, "").includes("/vendor")
  ? rawUrl.replace(/\/$/, "")
  : `${rawUrl.replace(/\/$/, "")}/vendor/auth?next=%2Fvendor`;

const config: CapacitorConfig = {
  appId: 'com.grabit.vendor',
  appName: 'GRABIT Vendor',
  webDir: 'www',
  appendUserAgent: 'CapacitorApp/GrabItVendor',
  server: {
    url: entryUrl,
    cleartext: entryUrl.startsWith("http://"),
  },
  android: {
    backgroundColor: '#0a0a0a',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
