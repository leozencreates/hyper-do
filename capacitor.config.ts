import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.hyperdo.app',
  appName: 'Hyper Do',
  webDir: 'dist-web',
  android: {
    backgroundColor: '#0f1117',
  },
  plugins: {
    // Native HTTP for fetch(): lets ICS/webcal calendar feeds load without CORS limits.
    CapacitorHttp: { enabled: true },
    LocalNotifications: {
      smallIcon: 'ic_stat_hyperdo',
      iconColor: '#ff8a3d',
    },
  },
}

export default config
