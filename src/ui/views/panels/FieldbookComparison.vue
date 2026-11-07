<script setup>
import { t } from '../../../i18n/index.js';
defineProps({ comparison: { type:Object,required:true }, notes: { type:Array,default:()=>[] } });
const when=(time)=>time.kind==='day'?time.date:time.kind==='instant'?time.at:`${time.start} — ${time.end}`;
const interpretation=(value)=>({observed:t('Observed'),inferred:t('Inferred'),unresolved:t('Unresolved')})[value];
</script>

<template>
  <div class="fieldbook-comparison">
    <p class="fieldbook-help">{{ t('Saved comparison metadata. External imagery is not downloaded when this card opens.') }}</p>
    <p>{{ t('Manual visual comparison') }} · {{ t('Unverified alignment') }}</p>
    <section v-for="[label,input] in [[t('Before'),comparison.snapshot.before],[t('After'),comparison.snapshot.after]]" :key="label">
      <h5>{{ label }} · {{ when(input.time) }}</h5>
      <dl>
        <dt>{{ t('Source') }}</dt><dd>{{ input.sourceLabel }}</dd>
        <dt>{{ t('Acquisition time') }}</dt><dd>{{ when(input.time) }}</dd>
        <dt>{{ t('Requested date') }}</dt><dd>{{ input.asset.requestedDate }}</dd>
        <dt>{{ t('Retrieved') }}</dt><dd>{{ input.retrievedAt || t('Unknown') }}</dd>
        <dt>{{ t('Availability checked') }}</dt><dd>{{ input.probedAt }}</dd>
        <dt>{{ t('Native resolution') }}</dt><dd>{{ t('{value} m',{value:input.nativeResolutionM}) }}</dd>
        <dt>{{ t('Scene cloud cover') }}</dt><dd>{{ input.cloudCoverPct===null?t('Unknown'):`${input.cloudCoverPct}%` }}</dd>
        <dt>{{ t('Coverage') }}</dt><dd>{{ input.coverage==='full'?t('Full'):input.coverage==='partial'?t('Partial'):t('Unknown') }}</dd>
        <dt>{{ t('Attribution') }}</dt><dd>{{ input.attribution }}</dd>
        <dt>{{ t('License') }}</dt><dd>{{ input.license }}</dd>
      </dl>
    </section>
    <section v-if="notes.length">
      <h5>{{ t('Change notes') }}</h5>
      <article v-for="note in notes" :key="note.id"><strong>{{ interpretation(note.interpretation) }}</strong><p>{{ note.text }}</p><small>{{ note.createdAt }} · {{ t('Supporting inputs') }}: {{ note.supportingEvidenceIds.map(id=>id===comparison.snapshot.before.evidenceId?t('Before'):t('After')).join(' / ') }}</small><p v-if="note.drawingId" class="fieldbook-help">{{ t('A saved polygon is linked to this interpretation.') }}</p></article>
    </section>
  </div>
</template>
