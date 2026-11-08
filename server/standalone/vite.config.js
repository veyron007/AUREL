import { freeOnlyPlugin, freeOnlyBrowserKeys } from './free-only.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { agentDeskPlugin } from '../agentDesk/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';
import { compressionPlugin } from './compression.js';
import { cacheHeadersPlugin } from './cacheHeaders.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** The installed Cesium release, which versions the Cesium script URL. */
export function installedCesiumVersion() {
  const { version } = createRequire(import.meta.url)('cesium/package.json');
  if (!/^\d+\.\d+\.\d+/.test(String(version)))
    throw new Error(`Unexpected Cesium version: ${version}`);
  return version;
}

/** Load this checkout's configuration and attach its local provider middleware. */
export function standaloneConfig(
  { command, mode },
  { nominatimStorageDir } = {},
) {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const tools = standaloneVoiceTools();
  const cesiumVersion = installedCesiumVersion();
  const browserConfig = createBrowserViteConfig({
    plugins: [
      freeOnlyPlugin(),
      // Both run ahead of every provider route (enforce: 'pre').
      compressionPlugin(),
      cacheHeadersPlugin({ cesiumVersion }),
      ...localProviderPlugins({
        freeOnly: true,
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
      agentDeskPlugin(),
      googleTokenUnavailablePlugin(),
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
    ],
    ...freeOnlyBrowserKeys(process.env),
    photonUrl: process.env.PHOTON_URL,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
    cesiumVersion,
    cesiumUnminified: process.env.GEV_CESIUM_UNMINIFIED === '1',
  });
  return {
    ...browserConfig,
    define: {
      ...browserConfig.define,
      'import.meta.env.GEV_FREE_ONLY': 'true',
    },
  };
}

export default defineConfig(standaloneConfig);
