import type { Plugin } from "vite";
import { createApiMiddleware, type ApiOptions } from "./api";

/** Mounts the scan/API middleware on both `vite` (development) and `vite preview` (the demo). */
export function terminatorApi(options: ApiOptions): Plugin {
  const middleware = createApiMiddleware(options);
  return {
    name: "terminator-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
