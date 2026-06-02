import { defineConfig } from "vite";
export default defineConfig({
    plugins: [],
    server: {
        port: 5173,
        headers: {
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://clerk.dosco.live; connect-src 'self' https: wss: ws: http://localhost:8000 http://127.0.0.1:8000; img-src 'self' blob: data: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; media-src 'self' blob: data: https:; frame-src 'self' blob: data:; worker-src 'self' blob:;",
        },
        proxy: {
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true
            },
            "/ws": {
                target: "ws://localhost:8000",
                ws: true,
                changeOrigin: true
            }
        }
    },
    build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        return undefined;
                    }
                    if (id.includes("react") || id.includes("scheduler")) {
                        return "vendor-react";
                    }
                    if (id.includes("@tanstack")) {
                        return "vendor-router";
                    }
                    if (id.includes("@clerk")) {
                        return "vendor-clerk";
                    }
                    if (id.includes("three") || id.includes("@types/three")) {
                        return "vendor-three";
                    }
                    if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype") || id.includes("prism")) {
                        return "vendor-markdown";
                    }
                    if (id.includes("zustand") || id.includes("zod")) {
                        return "vendor-state";
                    }
                    return "vendor-misc";
                }
            }
        }
    }
});
