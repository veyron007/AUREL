import { watch } from 'vue';
import { ChronicleController } from '../ui/chronicleController.js';
import { useChronicleStore } from '../ui/stores/chronicle.js';
import { useLensStore } from '../ui/stores/lens.js';
import { useFieldbookStore } from '../ui/stores/fieldbook.js';

const boxFrom = ([west, south, east, north]) => ({ west, south, east, north });
const inputKey = (input) =>
  `${input?.asset?.productId}:${input?.asset?.requestedDate}`;

/** Existing imagery owns its renderer and divider; Chronicle supplies explicit dated intent. */
export function createChronicleBindings({ pinia, dataManager, fieldbook }) {
  const lens = useLensStore(pinia);
  const library = useFieldbookStore(pinia);
  const lifetime = new AbortController();
  const disposers = new Set();
  let ownedPair = null;
  const comparisonKey = (value) =>
    JSON.stringify([
      inputKey(value.before),
      inputKey(value.after),
      value.extent,
    ]);
  const imagery = () => dataManager?.layers?.get('recent-imagery')?.module;
  const signalFor = (signal) => {
    const active = AbortSignal.any([lifetime.signal, signal].filter(Boolean));
    active.throwIfAborted();
    return active;
  };
  async function enabled(signal) {
    const owner = imagery();
    if (!owner) throw new Error('Dated imagery is unavailable.');
    const result = await dataManager.setEnabled('recent-imagery', true, {
      origin: 'tool',
      signal,
    });
    signal.throwIfAborted();
    if (
      result === false ||
      imagery() !== owner ||
      !dataManager.isEnabled('recent-imagery')
    )
      throw new Error('Dated imagery could not be enabled.');
    return owner;
  }
  function clearComparison() {
    const owner = imagery(),
      current = owner?.captureComparisonInputs?.();
    if (
      ownedPair &&
      current &&
      ownedPair.owner === owner &&
      comparisonKey(current) === ownedPair.key
    ) {
      owner.setMode('image');
      owner.setAssignment('a', null);
      owner.setAssignment('b', null);
    }
    ownedPair = null;
  }
  return {
    readSelection: () =>
      lifetime.signal.aborted ? null : lens.view?.selection || null,
    subscribeSelection(listener) {
      if (lifetime.signal.aborted) return () => {};
      const stop = watch(
        () => lens.view?.selection,
        () => listener(),
        { flush: 'sync' },
      );
      disposers.add(stop);
      return () => {
        stop();
        disposers.delete(stop);
      };
    },
    readEvidence() {
      const draft = library.view?.draft,
        selection = lens.view?.selection;
      if (!draft || !selection)
        return { observations: [], forecasts: [], notes: [] };
      const place = draft.places.find((row) =>
        row.geometry.coordinates.every(
          (value, i) => value === selection.geometry?.coordinates?.[i],
        ),
      );
      if (!place) return { observations: [], forecasts: [], notes: [] };
      return {
        observations: draft.evidence
          .filter(
            (row) => row.subjectId === place.id && row.kind === 'observation',
          )
          .map((row) => ({
            id: row.id,
            label: row.sourceLabel,
            applicableTime: row.applicableTime,
            sourceId: row.sourceId,
            sourceLabel: row.sourceLabel,
          })),
        forecasts: draft.analyses
          .filter((row) => row.subjectId === place.id)
          .flatMap((row) =>
            (row.snapshot?.checkpoints || []).flatMap((checkpoint, index) =>
              ['weather', 'airQuality']
                .map((kind) => {
                  const source = checkpoint.context?.[kind];
                  return (
                    source && {
                      id: `${row.id}:${index}:${kind}`,
                      label: source.sourceLabel,
                      validFrom: source.validFrom,
                      validTo: source.validTo,
                      sourceId: source.sourceId,
                      sourceLabel: source.sourceLabel,
                    }
                  );
                })
                .filter(Boolean),
            ),
          ),
        notes: draft.notes
          .filter((row) => row.subjectId === place.id)
          .map((row) => ({
            id: row.id,
            label: row.text,
            createdAt: row.createdAt,
          })),
      };
    },
    async searchImagery({ extent, startDate, endDate }, { signal } = {}) {
      const active = signalFor(signal),
        owner = await enabled(active);
      const snapshot = await owner.searchWindow(
        {
          box: boxFrom(extent),
          fromDay: startDate,
          toDay: endDate,
          products: ['S30', 'L30'],
        },
        { signal: active },
      );
      active.throwIfAborted();
      return {
        status: snapshot.error
          ? snapshot.candidates.length
            ? 'partial'
            : 'unavailable'
          : 'ready',
        reason: snapshot.error || null,
        candidates: snapshot.candidates.map((row) => ({
          id: row.key,
          label: `${row.product} · ${row.day}`,
          requestedDate: row.day,
          status: 'catalogued',
          descriptor: null,
        })),
      };
    },
    async probeImagery(id, { signal } = {}) {
      const active = signalFor(signal),
        owner = imagery();
      if (!owner || !dataManager.isEnabled('recent-imagery'))
        return { status: 'error', descriptor: null };
      const result = await owner.probeCandidate(id, { signal: active });
      active.throwIfAborted();
      return result;
    },
    async compareImagery(
      { extent, a, b, splitPosition = 0.5 },
      { signal } = {},
    ) {
      const active = signalFor(signal),
        owner = await enabled(active);
      const result = await owner.restoreComparison(
        {
          box: boxFrom(extent),
          a: { product: a.asset.productId, day: a.asset.requestedDate },
          b: { product: b.asset.productId, day: b.asset.requestedDate },
          split: Number.isFinite(splitPosition)
            ? Math.max(0, Math.min(1, splitPosition))
            : 0.5,
        },
        { signal: active },
      );
      if (!result.ok) return { ok: false, reason: result.reason };
      ownedPair = {
        owner,
        key: comparisonKey({ before: a, after: b, extent }),
      };
      if (active.aborted) {
        clearComparison();
        active.throwIfAborted();
      }
      const capture = owner.captureComparisonInputs();
      if (
        !capture ||
        inputKey(capture.before) !== inputKey(a) ||
        inputKey(capture.after) !== inputKey(b)
      ) {
        clearComparison();
        return { ok: false, reason: 'comparison-unavailable' };
      }
      ownedPair = {
        owner,
        key: comparisonKey({ before: a, after: b, extent }),
      };
      return { ok: true, splitPosition: capture.splitPosition };
    },
    readComparison: () =>
      lifetime.signal.aborted
        ? null
        : imagery()?.captureComparisonInputs?.() || null,
    clearComparison,
    saveComparison: (subject, snapshot) => {
      signalFor();
      return fieldbook.saveComparison(subject, snapshot);
    },
    addChangeNote: (comparisonId, note) => {
      signalFor();
      return fieldbook.addChangeNote(comparisonId, note);
    },
    destroy() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      [...disposers].forEach((stop) => stop());
      disposers.clear();
      clearComparison();
    },
  };
}

export function createChronicleTools(options) {
  const bindings = createChronicleBindings(options);
  const controller = new ChronicleController({
    ...bindings,
    store: useChronicleStore(options.pinia),
  });
  controller.init();
  return {
    controller,
    destroy() {
      bindings.destroy();
      controller.destroy();
    },
  };
}
