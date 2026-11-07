import { freeOnlyPlugin, freeOnlyBrowserKeys } from './free-only.js';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

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
  const browserConfig = createBrowserViteConfig({
    plugins: [
      freeOnlyPlugin(),
      ...localProviderPlugins({
        freeOnly: true,
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
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
