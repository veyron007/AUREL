import { createVoiceCommands as bindVoiceCommands } from './sessionCommands.js';
import { createLazySession } from './lazySession.js';
import { t } from '../i18n/index.js';
import { createProviderCommands } from './providerCommands.js';
import { createVoicePanelHost } from './panel/host.js';

// The providers' session code loads on the first voice or chat use, or when
// the application preloads it after start-up (src/voice/lazySession.js).
// Their capabilities are known up front: the controls render without it.
export const createRealtimeSession = createLazySession({
  load: () =>
    import('./realtimeSession.js').then(
      (module) => module.createRealtimeSession,
    ),
  capabilities: Object.freeze({ costControls: true, pushToTalk: true }),
});
export const createGeminiSession = createLazySession({
  load: () =>
    import('./geminiSession.js').then((module) => module.createGeminiSession),
  capabilities: () => ({
    costControls: false,
    pushToTalk: true,
    advisoryLimit: t(
      'Gemini voice sessions have a time limit. When a session expires, start voice again for a new conversation.',
    ),
  }),
});

/** Load the voice provider code now; the application calls it once idle. */
export function preloadVoiceSessions(provider) {
  const factory =
    provider === 'gemini' ? createGeminiSession : createRealtimeSession;
  return factory.preload();
}

/** Default composition; callers may supply another session adapter factory. */
export function createVoiceCommands(options = {}) {
  const panelHost =
    options.panel === true
      ? createVoicePanelHost({
          storage: options.panelStorage,
          clock: options.panelClock,
          readCockpitState: options.styleManager?.getCockpitState
            ? () => options.styleManager.getCockpitState()
            : undefined,
        })
      : null;
  const bind = (settings) =>
    bindVoiceCommands({
      ...settings,
      ...(panelHost
        ? {
            panelHost,
            nativePanelProvider: settings.createController
              ? null
              : settings.createSession === createRealtimeSession
                ? 'openai'
                : settings.createSession === createGeminiSession
                  ? 'gemini'
                  : null,
          }
        : {}),
    });
  let commands;
  // Generic hosts retain the existing default; standalone opts in explicitly.
  if (!options.createSession && options.supportedProviders !== undefined)
    commands = createProviderCommands(options, {
      bind,
      factories: { openai: createRealtimeSession, gemini: createGeminiSession },
    });
  else commands = bind({ createSession: createRealtimeSession, ...options });
  if (panelHost) {
    const lifetime = commands.signal ?? commands.session?.signal;
    lifetime?.addEventListener('abort', () => panelHost.destroy(), {
      once: true,
    });
    if (lifetime?.aborted) panelHost.destroy();
  }
  return commands;
}
