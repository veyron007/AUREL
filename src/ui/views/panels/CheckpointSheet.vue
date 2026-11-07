<script setup>
import { computed, ref } from 'vue';
import { t } from '../../../i18n/index.js';
import {
  buildCheckpointSheet,
  ENSEMBLE_THRESHOLDS,
  IMD_REFERENCE,
} from '../../../planner/checkpointSheet.js';
import { ANTECEDENT_DATASETS } from '../../../sources/mountainWeatherModel.js';

const props = defineProps({
  sheet: { type: Object, required: true },
  elevationSource: { type: String, required: true },
  departureAt: { type: String, default: null },
});
const model = computed(() =>
  buildCheckpointSheet(props.sheet, { departureAt: props.departureAt }),
);
const threshold = ref(ENSEMBLE_THRESHOLDS[0]);
const stamp = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const number = (value, digits = 1) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const lead = (hours) =>
  hours == null
    ? t('Unknown')
    : t('{value} h', { value: hours >= 0 ? `+${hours}` : String(hours) });
const datasetLabel = (key) => ANTECEDENT_DATASETS[key]?.label ?? t('Unknown');
const elevationLabel = computed(
  () =>
    ({
      'route-profile': t('Height from the saved route profile'),
      'terrain-lookup': t('Height from a terrain lookup'),
      'provider-dem': t('Provider terrain height (90 m DEM)'),
    })[props.elevationSource],
);
const rowLabels = {
  temperatureC: () => t('Temperature at this height'),
  freezingLevelM: () => t('Freezing level'),
  cloudLowPct: () => t('Low cloud'),
  cloudMidPct: () => t('Mid cloud'),
  cloudHighPct: () => t('High cloud'),
  visibilityM: () => t('Visibility'),
  capeJkg: () => t('Convective energy (CAPE)'),
  wind700Mps: () => t('Wind at 700 hPa'),
  wind500Mps: () => t('Wind at 500 hPa'),
  precipitation24Mm: () => t('Precipitation, next 24 h'),
  snowfall24Cm: () => t('Snowfall, next 24 h'),
};
function cell(row, entry) {
  if (entry.unsupported) return t('Not provided by this model');
  if (entry.value == null) return t('Unknown');
  const text = `${number(entry.value)} ${row.unit}`;
  return entry.direction == null
    ? text
    : t('{speed} from {direction}°', {
        speed: text,
        direction: entry.direction,
      });
}
const categoryLabel = (key) =>
  ({
    none: t('No rain'),
    'very-light': t('Very light'),
    light: t('Light'),
    moderate: t('Moderate'),
    heavy: t('Heavy'),
    'very-heavy': t('Very heavy'),
    'extremely-heavy': t('Extremely heavy'),
    'light-spell': t('Light spell'),
    'moderate-spell': t('Moderate spell'),
    'intense-spell': t('Intense spell'),
    'very-intense-spell': t('Very intense spell'),
    'extremely-intense-spell': t('Extremely intense spell'),
    cloudburst: t('Cloudburst intensity'),
  })[key] ?? t('Unknown');
const classLabel = (value) =>
  ({
    modelled: t('Modelled'),
    observed: t('Observed'),
    derived: t('Derived'),
    note: t('Reference'),
  })[value] ?? t('Unknown');
const stateLabel = (value) =>
  ({
    ready: t('Available'),
    partial: t('Partial'),
    stale: t('Stale'),
    empty: t('No values returned'),
    blocked: t('Blocked'),
    unavailable: t('Unavailable'),
  })[value] ?? t('Unknown');
const countAt = (day) =>
  day.counts.find((c) => c.threshold === Number(threshold.value));
const range = (low, high, unit = 'mm') =>
  high == null
    ? t('at least {low} {unit}', { low: number(low, 2), unit })
    : low === high
      ? `${number(low, 2)} ${unit}`
      : `${number(low, 2)}–${number(high, 2)} ${unit}`;
// A square-root scale keeps light totals readable beside the heavy IMD lines.
const x = (mm) =>
  96 +
  (Math.sqrt(Math.max(0, Math.min(mm, model.value.lane.scaleMax))) /
    Math.sqrt(model.value.lane.scaleMax)) *
    196;
const barWidth = (row) =>
  Math.max(2, (row.high == null ? 292 : x(row.high)) - x(row.low));
</script>

<template>
  <section class="checkpoint-sheet" :aria-label="t('Mountain weather sheet')">
    <div class="planner-section-heading"
      ><h5>{{ t('Mountain weather sheet') }}</h5
      ><span class="planner-tag">{{ classLabel('modelled') }}</span></div
    >
    <p class="checkpoint-sheet__elevation"
      >{{
        sheet.queried.elevationM == null
          ? t('Provider terrain height')
          : t('Resampled to {value} m', {
              value: sheet.queried.elevationM.toLocaleString(),
            })
      }}
      · {{ elevationLabel }}</p
    >
    <p class="planner-help"
      >{{ t('Focus hour') }} {{ stamp(model.focusAt) }} ·
      {{ stateLabel(model.forecastState) }}</p
    >
    <ul class="checkpoint-sheet__limits">
      <li>{{
        t(
          'Elevation downscaling is statistical: it adjusts temperature to this height and is not a summit observation.',
        )
      }}</li>
      <li>{{
        t(
          'Model cells of 0.25° (about 25 km) smooth ridges and cannot resolve a cloudburst a few kilometres across.',
        )
      }}</li>
    </ul>
    <div class="planner-table-scroll">
      <table class="checkpoint-sheet__models">
        <caption>{{
          t('Three models at the focus hour, side by side')
        }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ t('Value') }}</th>
            <th v-for="column in model.models" :key="column.id" scope="col">{{
              column.label
            }}</th>
            <th scope="col">{{ t('Spread') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr class="checkpoint-sheet__run">
            <th scope="row">{{ t('Run (UTC)') }}</th>
            <td v-for="column in model.models" :key="column.id">{{
              column.state === 'missing'
                ? t('Model missing')
                : stamp(column.runAt)
            }}</td>
            <td></td>
          </tr>
          <tr class="checkpoint-sheet__run">
            <th scope="row">{{ t('Lead') }}</th>
            <td v-for="column in model.models" :key="column.id">{{
              lead(column.leadHours)
            }}</td>
            <td></td>
          </tr>
          <tr v-for="row in model.rows" :key="row.key">
            <th scope="row">{{ rowLabels[row.key]() }}</th>
            <td
              v-for="entry in row.values"
              :key="entry.id"
              :data-unsupported="entry.unsupported || undefined"
              >{{ cell(row, entry) }}</td
            >
            <td>{{
              row.spread == null ? '—' : `${number(row.spread)} ${row.unit}`
            }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="planner-help">{{
      t(
        'Spread is the difference between the models. Disagreement is information about uncertainty, not a verdict.',
      )
    }}</p>

    <section class="checkpoint-sheet__block" :aria-label="model.ensemble.label">
      <div class="planner-section-heading"
        ><h6>{{ t('Ensemble precipitation fan') }}</h6
        ><span
          class="planner-source-state"
          :data-state="model.ensemble.state"
          >{{ stateLabel(model.ensemble.state) }}</span
        ></div
      >
      <p class="planner-help"
        >{{ model.ensemble.label }} · {{ t('Run (UTC)') }}
        {{ stamp(model.ensemble.runAt) }} · {{ t('Lead') }}
        {{ lead(model.ensemble.leadHours) }}</p
      >
      <template v-if="model.ensemble.days.length">
        <label class="checkpoint-sheet__threshold"
          >{{ t('Member threshold') }}
          <select v-model.number="threshold">
            <option
              v-for="value in ENSEMBLE_THRESHOLDS"
              :key="value"
              :value="value"
              >{{ t('{value} mm', { value: number(value) }) }}</option
            >
          </select></label
        >
        <p v-if="model.ensemble.focusDay" class="checkpoint-sheet__count">{{
          t(
            '{count} of {total} members at or above {threshold} mm on the focus day',
            {
              count: countAt(model.ensemble.focusDay).count,
              total: model.ensemble.focusDay.memberCount,
              threshold: number(threshold),
            },
          )
        }}</p>
        <div class="planner-table-scroll">
          <table class="checkpoint-sheet__fan">
            <caption>{{
              t(
                '24 h totals per member, windows ending 03:00 UTC as IMD reports',
              )
            }}</caption>
            <thead>
              <tr>
                <th scope="col">{{ t('Window ends (UTC)') }}</th>
                <th scope="col">{{ t('Median') }}</th>
                <th scope="col">{{ t('10th–90th percentile') }}</th>
                <th scope="col">{{ t('Members at or above threshold') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="day in model.ensemble.days"
                :key="day.start"
                :data-focus="day.focus || undefined"
              >
                <th scope="row">{{ stamp(day.end) }}</th>
                <td>{{ t('{value} mm', { value: number(day.median) }) }}</td>
                <td>{{ range(day.p10, day.p90) }}</td>
                <td>{{ countAt(day).count }}/{{ day.memberCount }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <section class="checkpoint-sheet__block" :aria-label="t('Rain lane')">
      <div class="planner-section-heading"
        ><h6>{{ t('Rain lane') }}</h6
        ><span class="planner-tag">{{ t('24 h totals') }}</span></div
      >
      <svg
        v-if="model.lane.rows.length"
        class="checkpoint-sheet__lane"
        :viewBox="`0 0 300 ${24 + model.lane.rows.length * 22}`"
        role="img"
        :aria-label="t('24 h rainfall totals drawn against IMD category lines')"
      >
        <g v-for="line in model.lane.lines" :key="line.key">
          <line
            class="checkpoint-sheet__imd"
            :x1="x(line.mm)"
            :x2="x(line.mm)"
            y1="14"
            :y2="18 + model.lane.rows.length * 22"
          />
          <text class="checkpoint-sheet__imd-label" :x="x(line.mm)" y="10">{{
            number(line.mm)
          }}</text>
        </g>
        <g
          v-for="(row, index) in model.lane.rows"
          :key="row.key"
          :data-class="row.class"
        >
          <text
            class="checkpoint-sheet__lane-label"
            x="2"
            :y="32 + index * 22"
            >{{ row.label }}</text
          >
          <rect
            class="checkpoint-sheet__bar"
            :x="x(row.low)"
            :y="22 + index * 22"
            :width="barWidth(row)"
            height="12"
          />
          <line
            v-if="row.median != null"
            class="checkpoint-sheet__median"
            :x1="x(row.median)"
            :x2="x(row.median)"
            :y1="20 + index * 22"
            :y2="36 + index * 22"
          />
        </g>
      </svg>
      <p class="planner-help">{{
        t(
          'Lines mark the lower bound of IMD light, moderate, heavy, very heavy and extremely heavy 24 h rainfall. Ensemble bars span the 10th–90th percentile; reanalysis shows the wettest of the last seven days.',
        )
      }}</p>
    </section>

    <section
      class="checkpoint-sheet__block"
      :aria-label="t('Antecedent rainfall, 7 days')"
    >
      <div class="planner-section-heading"
        ><h6>{{ t('Antecedent rainfall, 7 days') }}</h6
        ><span
          class="planner-source-state"
          :data-state="model.antecedent.state"
          >{{ stateLabel(model.antecedent.state) }}</span
        ></div
      >
      <p
        v-if="model.antecedent.totalMm != null"
        class="checkpoint-sheet__count"
        >{{
          t('{value} mm in seven IMD days ({dataset})', {
            value: number(model.antecedent.totalMm),
            dataset: datasetLabel(model.antecedent.dataset),
          })
        }}</p
      >
      <p v-if="model.antecedent.windowStart" class="planner-help"
        >{{ stamp(model.antecedent.windowStart) }} →
        {{ stamp(model.antecedent.windowEnd) }}</p
      >
      <p class="planner-help">{{
        t(
          'Reanalysis arrives about five days late, so the most recent days are not included. ERA5-Land is used when available; otherwise ERA5 at 0.25°.',
        )
      }}</p>
    </section>

    <section
      class="checkpoint-sheet__block"
      :aria-label="t('Observed satellite rain (IMERG)')"
    >
      <div class="planner-section-heading"
        ><h6>{{ t('Observed satellite rain (IMERG)') }}</h6
        ><span class="planner-source-state" :data-state="model.imerg.state">{{
          stateLabel(model.imerg.state)
        }}</span></div
      >
      <template v-if="model.imerg.totalLowMm != null">
        <p class="checkpoint-sheet__count"
          >{{
            t('Last 24 h: {range}', {
              range: range(model.imerg.totalLowMm, model.imerg.totalHighMm),
            })
          }}
          · {{ categoryLabel(model.imerg.categoryLow)
          }}<template
            v-if="
              model.imerg.categoryHigh &&
              model.imerg.categoryHigh !== model.imerg.categoryLow
            "
          >
            – {{ categoryLabel(model.imerg.categoryHigh) }}</template
          ></p
        >
        <p class="planner-help"
          >{{ stamp(model.imerg.windowStart) }} →
          {{ stamp(model.imerg.windowEnd) }} ·
          {{
            t('0.1° cell centred at {lat}°, {lon}°', {
              lat: model.imerg.cell.lat,
              lon: model.imerg.cell.lon,
            })
          }}</p
        >
        <p v-if="model.imerg.peak" class="planner-help"
          >{{
            t('Peak 30-minute rate: {range}', {
              range: range(
                model.imerg.peak.lowMmH,
                model.imerg.peak.highMmH,
                'mm/h',
              ),
            })
          }}
          · {{ categoryLabel(model.imerg.peak.spell) }}</p
        >
        <p v-if="model.imerg.missingCount" class="planner-help">{{
          t(
            '{count} of 48 half-hours have no estimate; the total is a lower bound.',
            { count: model.imerg.missingCount },
          )
        }}</p>
      </template>
      <p class="planner-help">{{
        t(
          'Satellite estimate read from the published colormap classes, so totals are ranges. It is not a rain-gauge reading.',
        )
      }}</p>
    </section>

    <p class="checkpoint-sheet__authority"
      >{{
        t(
          'IMD categories describe observed 24 h totals; they are not warnings. IMD remains the warning authority.',
        )
      }}
      <a
        :href="IMD_REFERENCE.authority"
        target="_blank"
        rel="noopener noreferrer"
        >{{ t('India Meteorological Department') }}</a
      >
      ·
      <a :href="IMD_REFERENCE.link" target="_blank" rel="noopener noreferrer">{{
        t('IMD category definitions')
      }}</a></p
    >
    <details class="planner-details">
      <summary>{{ t('Sources, classes and licences') }}</summary>
      <dl class="planner-source-details">
        <template v-for="source in model.sources" :key="source.kind">
          <dt>{{ source.sourceLabel }}</dt>
          <dd
            >{{ classLabel(source.class) }} · {{ stateLabel(source.state) }} ·
            {{ t('Retrieved') }} {{ stamp(source.retrievedAt) }} ·
            {{ source.license }}<br />{{ source.attribution }}<br /><a
              :href="source.link"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('Open source') }}</a
            ></dd
          >
        </template>
      </dl>
    </details>
  </section>
</template>
