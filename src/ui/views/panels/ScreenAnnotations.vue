<script setup>
import { storeToRefs } from 'pinia';
import { useScreenAnnotationsStore } from '../../stores/screenAnnotations.js';

// The screen-space annotation board over the page, as the screen annotation
// renderer (src/annotations/screenAnnotationRenderer.js) presents it. Only the
// board's structure is rendered here; the renderer writes each frame's
// geometry (positions, sizes, opacity, display) onto the elements it is
// handed, so a camera move does not re-render this view.
const { board, controls } = storeToRefs(useScreenAnnotationsStore());

// Each element goes to the renderer it was rendered for, which positions it.
const vAnnoElement = {
  mounted(el, { value }) {
    controls.value?.attach(value.owner, value.key, value.kind, el);
  },
  beforeUnmount(el, { value }) {
    controls.value?.attach(value.owner, value.key, value.kind, null);
  },
};
const handle = (mark, kind) => ({ owner: board.value.owner, key: mark.key, kind });
const part = (mark, child) => handle(mark, `part:${child.key}`);
// The draw-on stroke reads solid once its dashoffset transition ends.
const onTransitionEnd = (owner, key) => (event) => {
  if (event.propertyName === 'stroke-dashoffset')
    controls.value?.drawn(owner, key);
};
const drawStyle = (mark, child) =>
  mark.drawn && child.attrs.class?.includes('gev-draw')
    ? { strokeDasharray: 'none' }
    : undefined;
</script>

<template>
  <Teleport v-if="board" to="body">
    <div class="gev-screen-whiteboard"><svg class="gev-screen-whiteboard-svg" preserveAspectRatio="none" :viewBox="board.viewBox ?? undefined"><defs><filter id="gev-sketch" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" /></filter><marker v-for="marker in board.markers" :id="`gev-arrow-${marker.key}`" :key="marker.key" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" :fill="marker.fill" /></marker></defs><g v-for="mark in board.marks" :key="mark.key" v-anno-element="handle(mark, 'group')" :class="mark.className" :onTransitionend="onTransitionEnd(board.owner, mark.key)"><template v-for="child in mark.children" :key="child.key"><polygon v-if="child.tag === 'polygon'" v-anno-element="part(mark, child)" v-bind="child.attrs" :style="drawStyle(mark, child)" /><polyline v-else-if="child.tag === 'polyline'" v-anno-element="part(mark, child)" v-bind="child.attrs" :style="drawStyle(mark, child)" /><path v-else-if="child.tag === 'path'" v-anno-element="part(mark, child)" v-bind="child.attrs" :style="drawStyle(mark, child)" /><circle v-else-if="child.tag === 'circle'" v-anno-element="part(mark, child)" v-bind="child.attrs" /><line v-else-if="child.tag === 'line'" v-anno-element="part(mark, child)" v-bind="child.attrs" /><g v-else-if="child.tag === 'callout'" v-anno-element="handle(mark, 'callout')" class="gev-anno-callout"><rect v-anno-element="handle(mark, 'card')" rx="5" class="gev-anno-card" /><rect v-anno-element="handle(mark, 'accent')" class="gev-anno-accent" width="3" rx="1.5" :fill="child.fill" /><text v-anno-element="handle(mark, 'text')" class="gev-anno-text" x="9" y="16">{{ child.text }}</text></g></template></g></svg></div>
  </Teleport>
</template>
