import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { isLocaleLoaded, loadLocale, t } from './i18n/index.js';
import { DEFAULT_LOCALE, resolveLocale } from './i18n/locale.js';
import { markStartup, STARTUP_MARKS } from './app/startupMarks.js';

markStartup(STARTUP_MARKS.cesiumReady);

// The Vite boundary exposes only undefined, null, or a validated URL.
const photonSetting = import.meta.env.PHOTON_URL;

/** The page's application, set once its language is ready (a live binding). */
let application;

function showStartupError(error) {
  console.error("God's Eye View initialization failed:", error);
  // The cover is emptied once start-up finishes; a later failure only logs.
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  if (!loaderStatus) return;
  loaderStatus.textContent = t('Error: {message}', {
    message: describeError(error),
  });
  loaderStatus.style.color = '#ff4444';
}

function startApplication(locale) {
  application = createStandaloneApplication({
    googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
    geospatial:
      photonSetting === undefined
        ? {}
        : { endpoints: { photon: photonSetting } },
    allowQaRegistration: import.meta.env.DEV,
    locale,
  });
  return application
    .start()
    .then(() => markStartup(STARTUP_MARKS.bootstrapDone));
}

// Only the active language's catalog is downloaded, before the first view
// renders, so no English frame shows. English needs none and starts at once.
// A catalog that cannot load leaves the page in English rather than blank.
const bootLocale = resolveLocale();
const started = isLocaleLoaded(bootLocale)
  ? startApplication(bootLocale)
  : loadLocale(bootLocale).then(
      () => startApplication(bootLocale),
      (error) => {
        console.error(`[i18n] the ${bootLocale} catalog did not load`, error);
        return startApplication(DEFAULT_LOCALE);
      },
    );
started.catch(showStartupError);

export { application };
