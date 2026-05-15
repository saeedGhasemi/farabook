import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.05ac75e6dd51463c870e5e7110828f3c",
  appName: "farabook",
  webDir: "dist",
  server: {
    url: "https://05ac75e6-dd51-463c-870e-5e7110828f3c.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: true,
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false },
    },
  },
};

export default config;
