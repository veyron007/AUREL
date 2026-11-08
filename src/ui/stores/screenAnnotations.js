import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';

/**
 * The screen-space annotation board's STRUCTURE as its view renders it. The
 * screen annotation renderer (src/annotations/screenAnnotationRenderer.js)
 * presents it only when marks, text, classes or markers change — never per
 * frame. The view hands back every element it renders; the renderer writes
 * each frame's geometry onto them directly and hears when a draw-on stroke
 * finishes.
 */
export const useScreenAnnotationsStore = defineStore(
  'gev-screen-annotations',
  () => {
    /**
     * `{owner, viewBox, markers, marks}`, or null while no renderer exists.
     * Each mark is `{key, className, drawn, children}`; a child is
     * `{key, tag, attrs}` (static attributes) or the callout
     * `{key: 'callout', tag: 'callout', text, fill}`. `owner` is passed back
     * with each element and report.
     */
    const board = shallowRef(null);

    /** @param {?object} next A fresh structure; every publish re-renders. */
    function publish(next) {
      board.value = next && markRaw(next);
    }

    /**
     * The controls whose `attach(owner, key, kind, element)` and
     * `drawn(owner, key)` the view calls.
     */
    const controls = shallowRef(null);

    /** @param {?object} next The controls, or null to disconnect. */
    function connect(next) {
      controls.value = next && markRaw(next);
    }

    return { board, publish, controls, connect };
  },
);
