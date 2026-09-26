import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { terminatorApi } from "./server/plugin";

const webDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Prefix "" loads GOOGLE_API_KEY for the server only; the browser only ever sees VITE_* variables.
  const env = loadEnv(mode, webDir, "");
  return {
    plugins: [
      terminatorApi({
        outDir: fileURLToPath(new URL("../out", import.meta.url)),
        cacheDir: fileURLToPath(new URL("./.cache", import.meta.url)),
        apiKey: env.GOOGLE_API_KEY || undefined,
      }),
    ],
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
