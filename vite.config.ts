import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the dashboard SPA (ADR-0009).
 *
 * - `root` is `src/app` so the dev server serves `index.html` directly.
 * - Build output is `dist/app`, served by Fastify's @fastify/static in prod.
 * - `base` is `/app/` so asset URLs match the Fastify static prefix in prod.
 * - In dev (`pnpm app:dev`) the Vite dev server runs on 5173 and proxies
 *   `/webhook`, `/health`, `/app/events` and `/app/api` to the backend on 8080,
 *   so the SPA can talk to the real SSE/JSON endpoints during development.
 */
export default defineConfig({
	base: "/app/",
	root: resolve(__dirname, "src", "app"),
	plugins: [react()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src", "app"),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/webhook": { target: "http://127.0.0.1:8080", changeOrigin: true },
			"/health": { target: "http://127.0.0.1:8080", changeOrigin: true },
			"/app/events": {
				target: "http://127.0.0.1:8080",
				changeOrigin: true,
			},
			"/app/api": { target: "http://127.0.0.1:8080", changeOrigin: true },
		},
	},
	build: {
		outDir: resolve(__dirname, "dist", "app"),
		emptyOutDir: true,
	},
});
