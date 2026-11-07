<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { formatNumber, t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import { useCorroborationStore } from '../../stores/corroboration.js';

const store = useCorroborationStore();
const { view } = storeToRefs(store);
const card = computed(() => view.value?.card ?? null);
const fire = computed(() => view.value?.kind === 'fire');

const STATUS = {
  agree: () => (fire.value ? t('Two sensors detect this fire') : t('Sources agree within tolerance')),
  disagree: () => t('Sources disagree'),
  'single-source': () => (fire.value ? t('One sensor only') : t('Single source')),
  unavailable: () => t('Second source unavailable'),
};
const status = computed(() => STATUS[card.value?.status]?.() ?? '');

const STATE = {
  ok: () => t('Answered'),
  partial: () => t('Partial'),
  empty: () => t('No record'),
  stale: () => t('Stale'),
  loaded: () => t('Loaded'),
  unavailable: () => t('Unavailable'),
  denied: () => t('Request budget reached'),
};
const rowState = (row) => (row.matched ? t('Matched') : (STATE[row.state]?.() ?? t('Unknown')));
const role = (row) =>
  !row.matched
    ? ''
    : row.role === 'dependent'
      ? t('Same origin as the primary source; not counted')
      : row.possiblyShared
        ? t('Independent, but may share feeders')
        : t('Independent');

const QUANTITY = {
  magnitude: () => t('Magnitude'),
  'magnitude-difference': () => t('Magnitude difference'),
  'time-offset': () => t('Time offset'),
  'position-residual': () => t('Position residual'),
  'depth-difference': () => t('Depth difference'),
  depth: () => t('Depth'),
  frp: () => t('Fire radiative power'),
  altitude: () => t('Altitude'),
  'ground-speed': () => t('Ground speed'),
  'altitude-difference': () => t('Altitude difference'),
};
const CLASS = {
  observed: () => t('Observed'),
  derived: () => t('Derived'),
  modelled: () => t('Modelled'),
  simulated: () => t('Simulated'),
  note: () => t('Note'),
};
const stamp = (value) =>
  value == null ? t('Unknown') : new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const signed = (value) =>
  value == null ? t('Unknown') : `${value > 0 ? '+' : ''}${formatNumber(value, { maximumFractionDigits: 2 })}`;
const amount = (q) =>
  q.id.includes('difference') || q.id === 'time-offset'
    ? signed(q.value)
    : q.value == null
      ? t('Unknown')
      : formatNumber(q.value, { maximumFractionDigits: 2 });
const quantityMeta = (q) => `${CLASS[q.class]?.() ?? t('Note')} · ${q.source} · ${stamp(q.at)}`;

const OUTSIDE = { time: () => t('time'), position: () => t('position'), magnitude: () => t('magnitude'), altitude: () => t('altitude') };
function noteText(note) {
  switch (note.code) {
    case 'outside-agreement':
      return t('Outside the agreement bounds for: {quantities}', { quantities: note.quantities.map((q) => OUTSIDE[q]?.() ?? q).join(', ') });
    case 'catalogue-author':
      return t('Solution authored by {author}', { author: note.author });
    case 'magnitude-types-differ':
      return t('Magnitude types differ ({primary} and {other}); differences of a few tenths are expected.', note);
    case 'served-stale':
      return t('Served from cache after the source failed.');
    case 'position-type':
      return t('Position from {type}, not the aircraft’s own broadcast.', note);
    case 'propagated-to-reference':
      return t('Moved along its reported track to the same instant before comparing.');
    case 'one-sensor-common':
      return t('One-sensor detections are common: VIIRS resolves smaller fires than MODIS, and the satellites pass at different times.');
    case 'quake-window':
      return t('Searched ±{windowS} s and {candidateKm} km. Agreement means within {agreeS} s, {agreeKm} km and {agreeMag} magnitude units.', note);
    case 'fire-window':
      return t('Searched ±{windowMin} min and {distanceKm} km for the other instrument family.', note);
    case 'aircraft-window':
      return t('Agreement means within {agreeKm} km after time alignment, {maxOffsetS} s and {agreeAltFt} ft.', note);
    case 'aircraft-hex':
      return t('ICAO address {hex}', note);
    case 'no-reference':
      return t('No reference position is available for this aircraft.');
    case 'reference-from-layer':
      return t('Reference is the map layer’s report because adsb.lol did not answer.');
    case 'same-distributor':
      return t('All FIRMS detections arrive through one distributor; each satellite observes separately.');
    default:
      return '';
  }
}

const NODES = { usgs: 'USGS', emsc: 'EMSC', geofon: 'GFZ GEOFON', 'adsb-lol': 'adsb.lol', 'adsb-fi': 'adsb.fi', opensky: 'OpenSky Network' };
const node = (id) => (id === 'local-receiver' ? t('Local receiver') : (NODES[id] ?? id));
const dependencyNotes = computed(() => {
  const edges = card.value?.dependency?.edges ?? [];
  const lines = [];
  for (const edge of edges) {
    const names = { from: node(edge.from), to: node(edge.to) };
    if (edge.relation === 'relays') lines.push(t('{from} relays the {to} solution for this event, so it is not a second source.', names));
    else if (edge.relation === 'feeds' && edge.certainty === 'declared') lines.push(t('{from} feeds {to} in this installation, so they count once.', names));
    else if (edge.relation === 'shares-feeders' || edge.relation === 'feeds') lines.push(t('{from} and {to} may share volunteer receivers; the overlap is not published.', names));
  }
  if (edges.some((edge) => edge.relation === 'shares-stations')) lines.push(t('Seismic agencies compute separate solutions, often from overlapping public station networks.'));
  return [...new Set(lines)];
});
const independence = computed(() => {
  const d = card.value?.dependency;
  if (!d) return '';
  return d.minIndependent < d.maxIndependent
    ? t('Independent sources here: between {min} and {max}, depending on unpublished feeder overlap.', { min: d.minIndependent, max: d.maxIndependent })
    : t('Independent sources here: {count}', { count: d.maxIndependent });
});
const attribution = computed(() =>
  view.value?.kind === 'quake'
    ? t('Catalogues: USGS; EMSC-CSEM SeismicPortal (CC BY 4.0); GEOFON data centre, GFZ Helmholtz Centre for Geosciences.')
    : view.value?.kind === 'aircraft'
      ? t('Aircraft: adsb.lol; adsb.fi open data for personal, non-commercial use.')
      : t('Fires: NASA FIRMS (VIIRS and MODIS).'),
);
</script>

<template>
  <section v-if="view" class="corroboration" aria-labelledby="corroboration-title">
    <h3 id="corroboration-title">{{ t('Second Source') }}</h3>
    <p v-if="view.status === 'loading'" class="lens-explanation" role="status">{{ t('Checking an independent source…') }}</p>
    <p v-else-if="view.status === 'error'" class="lens-message lens-error" role="alert">{{ t('The corroboration check failed. Retry, or rely on the single source.') }}</p>
    <p v-else-if="view.status === 'unsupported' || !card" class="lens-explanation">{{ t('No second-source check applies to this selection yet.') }}</p>
    <template v-else>
      <p class="corroboration-status" :data-status="card.status" role="status">{{ status }}</p>
      <div class="corroboration-wording">
        <p>{{ t('Disagreement between sources is normal: agencies and receivers use different stations, methods and update times.') }}</p>
        <p>{{ t('Agreement is not proof: sources can share inputs or errors, so a match does not make a value true.') }}</p>
      </div>
      <article class="corroboration-row" data-role="primary">
        <h4>{{ card.primary.label }} <span class="lens-kind">{{ t('Primary') }}</span></h4>
        <dl v-if="card.primary.quantities.length" class="lens-details">
          <div v-for="q in card.primary.quantities" :key="q.id">
            <dt>{{ QUANTITY[q.id]?.() ?? q.id }}</dt>
            <dd>{{ amount(q) }} {{ q.unit }}</dd>
            <dd class="corroboration-meta">{{ quantityMeta(q) }}</dd>
          </div>
        </dl>
      </article>
      <article v-for="row in card.rows" :key="row.nodeId" class="corroboration-row" :data-matched="row.matched" :data-agree="row.agree">
        <h4>{{ row.label }} <span class="lens-kind">{{ rowState(row) }}</span></h4>
        <p v-if="role(row)" class="corroboration-role">{{ role(row) }}</p>
        <dl v-if="row.quantities.length" class="lens-details">
          <div v-for="q in row.quantities" :key="q.id">
            <dt>{{ QUANTITY[q.id]?.() ?? q.id }}</dt>
            <dd>{{ amount(q) }} {{ q.unit }}</dd>
            <dd class="corroboration-meta">{{ quantityMeta(q) }}</dd>
          </div>
        </dl>
        <ul v-if="row.notes.length" class="corroboration-notes">
          <li v-for="(note, index) in row.notes" :key="index">{{ noteText(note) }}</li>
        </ul>
      </article>
      <section class="corroboration-dependency">
        <h4>{{ t('Shared inputs') }}</h4>
        <p>{{ independence }}</p>
        <ul class="corroboration-notes">
          <li v-for="line in dependencyNotes" :key="line">{{ line }}</li>
        </ul>
      </section>
      <ul class="corroboration-notes corroboration-method">
        <li v-for="(note, index) in card.notes" :key="index">{{ noteText(note) }}</li>
      </ul>
      <p class="lens-attribution">
        {{ attribution }}
        <a v-if="view.kind === 'aircraft'" href="https://adsb.fi/" translate="no" target="_blank" rel="noopener noreferrer">adsb.fi</a>
      </p>
      <p class="lens-attribution">{{ t('Checked (UTC)') }}: {{ stamp(card.checkedAt) }}</p>
    </template>
    <UiButton v-if="view.status !== 'loading'" @click="store.act('refresh')">{{ t('Check again') }}</UiButton>
  </section>
</template>
