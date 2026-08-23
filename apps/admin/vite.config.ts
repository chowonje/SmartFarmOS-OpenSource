import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const LOOPBACK_API_PORT = process.env.SMARTFARM_DEMO_PORT ?? "3100";

function createAdminProxy(): Record<string, ProxyOptions> {
  const demoKey = process.env.SMARTFARM_DEMO_KEY;
  if (demoKey === undefined || demoKey.trim() === "") return {};

  return {
    "/api": {
      target: `http://127.0.0.1:${LOOPBACK_API_PORT}`,
      changeOrigin: false,
      rewrite: (path) => path.replace(/^\/api/, ""),
      headers: {
        "x-smartfarm-demo-key": demoKey,
        "x-smartfarm-demo-role": "admin",
        "x-smartfarm-demo-principal": "admin:local-console",
      },
    },
  };
}

const proxy = createAdminProxy();

export default defineConfig({
  plugins: [react()],
  envPrefix: "PUBLIC_",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    proxy,
  },
});
