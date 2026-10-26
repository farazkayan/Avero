import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'node:fs'
import path from 'node:path'

function getEnvOverrides() {
  const envPaths = [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'app/avero/.env'),
  ]
  const result: Record<string, string> = {}
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq !== -1) {
          const key = trimmed.slice(0, eq).trim()
          const val = trimmed.slice(eq + 1).trim()
          if (key && val && !val.includes('your_') && !val.includes('your-project')) {
            result[key] = val
            process.env[key] = val
          }
        }
      }
    }
  }
  return result
}

const envOverrides = getEnvOverrides()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'bundle-analysis.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  define: {
    ...(envOverrides.VITE_SUPABASE_URL
      ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(envOverrides.VITE_SUPABASE_URL) }
      : {}),
    ...(envOverrides.VITE_SUPABASE_PUBLISHABLE_KEY
      ? { 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(envOverrides.VITE_SUPABASE_PUBLISHABLE_KEY) }
      : {}),
    ...(envOverrides.VITE_LOCATIONIQ_API_KEY
      ? { 'import.meta.env.VITE_LOCATIONIQ_API_KEY': JSON.stringify(envOverrides.VITE_LOCATIONIQ_API_KEY) }
      : {}),
    ...(envOverrides.VITE_BARIKOI_API_KEY
      ? { 'import.meta.env.VITE_BARIKOI_API_KEY': JSON.stringify(envOverrides.VITE_BARIKOI_API_KEY) }
      : {}),
    ...(envOverrides.VITE_CARTO_API_KEY
      ? { 'import.meta.env.VITE_CARTO_API_KEY': JSON.stringify(envOverrides.VITE_CARTO_API_KEY) }
      : {}),
    ...(envOverrides.VITE_USE_BARIKOI_FALLBACK
      ? { 'import.meta.env.VITE_USE_BARIKOI_FALLBACK': JSON.stringify(envOverrides.VITE_USE_BARIKOI_FALLBACK) }
      : {}),
  },
})
