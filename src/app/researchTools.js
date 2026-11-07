import { watch } from 'vue';
import { ResearchController } from '../ui/researchController.js';
import { useLensStore } from '../ui/stores/lens.js';
import { useResearchStore } from '../ui/stores/research.js';
import { createSentinelResearchSource } from '../sources/sentinelResearch.js';

/** Native local export; no raster bytes, notes or credentials are sent to another service. */
export function createResearchTools({
  pinia,
  source = createSentinelResearchSource(),
  exportResult,
} = {}) {
  const lens = useLensStore(pinia),
    urls = new Map();
  function download(result) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    );
    const release = () => {
      clearTimeout(urls.get(url));
      urls.delete(url);
      URL.revokeObjectURL(url);
    };
    urls.set(url, setTimeout(release, 30000));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aurel-ndvi-${result.sceneId}.json`;
    try {
      anchor.click();
      return true;
    } catch (error) {
      release();
      throw error;
    }
  }
  const controller = new ResearchController({
    source,
    store: useResearchStore(pinia),
    readSelection: () => lens.view?.selection || null,
    subscribeSelection: (listener) =>
      watch(() => lens.view?.selection, listener, { flush: 'sync' }),
    exportResult: exportResult || download,
  });
  controller.init();
  return {
    controller,
    destroy() {
      controller.destroy();
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    },
  };
}
