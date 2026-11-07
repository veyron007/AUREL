import { t } from '../i18n/index.js';
import { buildCheckpointSheet } from './checkpointSheet.js';
import { ANTECEDENT_DATASETS } from '../sources/mountainWeatherModel.js';

const mm = (value) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const range = (low, high) =>
  high == null
    ? t('at least {low} {unit}', { low: mm(low), unit: 'mm' })
    : `${mm(low)}–${mm(high)} mm`;

/**
 * Chronicle precipitation lane: saved checkpoint sheets as dated rows. Each
 * row keeps its class in the label and its own window; nothing is refetched.
 */
export function precipitationEvidence(analyses) {
  const rows = [];
  for (const analysis of analyses) {
    const snapshot = analysis.snapshot;
    (snapshot?.checkpoints || []).forEach((checkpoint, index) => {
      const saved = checkpoint.mountainWeather;
      if (!saved) return;
      let sheet;
      try {
        sheet = buildCheckpointSheet(saved.sheet, {
          departureAt: snapshot.departureAt,
        });
      } catch {
        return;
      }
      const id = `${analysis.id}:${index}`;
      const sources = saved.sheet;
      if (sheet.imerg.totalLowMm !== null)
        rows.push({
          id: `${id}:imerg`,
          label: t('IMERG 24 h {range} · observed satellite estimate', {
            range: range(sheet.imerg.totalLowMm, sheet.imerg.totalHighMm),
          }),
          start: sheet.imerg.windowStart,
          end: sheet.imerg.windowEnd,
          sourceId: sources.imerg.sourceId,
          sourceLabel: sources.imerg.sourceLabel,
        });
      if (sheet.antecedent.totalMm !== null)
        rows.push({
          id: `${id}:antecedent`,
          label: t('{dataset} 7-day total {value} mm · modelled reanalysis', {
            dataset: ANTECEDENT_DATASETS[sheet.antecedent.dataset].label,
            value: mm(sheet.antecedent.totalMm),
          }),
          start: sheet.antecedent.windowStart,
          end: sheet.antecedent.windowEnd,
          sourceId: sources.antecedent.sourceId,
          sourceLabel: sources.antecedent.sourceLabel,
        });
      const day = sheet.ensemble.focusDay;
      if (day)
        rows.push({
          id: `${id}:ensemble`,
          label: t(
            'ECMWF ENS {count} of {total} members at or above 1 mm · modelled',
            { count: day.counts[0].count, total: day.memberCount },
          ),
          start: day.start,
          end: day.end,
          sourceId: sources.ensemble.sourceId,
          sourceLabel: sources.ensemble.sourceLabel,
        });
    });
  }
  return rows;
}
