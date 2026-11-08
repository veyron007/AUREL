/**
 * Reusable fire-marker sprites, pooled by sprite image.
 *
 * Adding or removing one billboard makes Cesium rebuild the whole vertex
 * array of the collection (about 35 ms for 40,000 sprites), and creating one
 * costs about 3 us of script time. A marker set rebuild therefore hides
 * markers that leave instead of removing them, and shows a hidden sprite of
 * the same image for a marker that enters, moving it and renaming its pick
 * id. Because a pooled sprite never changes image, the texture atlas never
 * gains an entry. The pool only grows, to the largest set drawn per image,
 * which the band caps bound (40,000 markers).
 */

/**
 * @param {{
 *   create: (fire: object) => object,
 *   pickIndex: Map<string, object>,
 *   pickIdFor: (fire: object) => string,
 * }} options `create` adds a hidden billboard with the image of `fire`, whose key is the pool key.
 */
export function createMarkerPool({ create, pickIndex, pickIdFor }) {
  /** @type {Map<string, object[]>} hidden sprites by image key */
  const free = new Map();
  /** @type {WeakMap<object, string>} image key of every pooled sprite */
  const keyOf = new WeakMap();

  function freeList(key) {
    let list = free.get(key);
    if (!list) {
      list = [];
      free.set(key, list);
    }
    return list;
  }

  /** Add `count` hidden sprites for `key` (the image of `fire`). */
  function grow(key, count, fire) {
    const list = freeList(key);
    for (let i = 0; i < count; i++) {
      const billboard = create(fire);
      billboard.show = false;
      keyOf.set(billboard, key);
      list.push(billboard);
    }
  }

  return {
    /** Hidden sprites ready for `key`. */
    available(key) {
      return free.get(key)?.length ?? 0;
    },

    grow,

    /**
     * A hidden sprite for `fire`, moved to `position` and renamed for
     * picking. It stays hidden until the horizon pass shows it.
     */
    take(key, fire, position, color, equalColor) {
      const list = freeList(key);
      if (!list.length) grow(key, 1, fire);
      const billboard = list.pop();
      const pickId = pickIdFor(fire);
      billboard.id = pickId;
      billboard.position = position;
      if (!equalColor(billboard.color, color)) billboard.color = color;
      pickIndex.set(pickId, fire);
      return billboard;
    },

    /** Hide a sprite whose fire left the set and keep it for reuse. */
    release(billboard) {
      pickIndex.delete(billboard.id);
      billboard.show = false;
      freeList(keyOf.get(billboard) ?? '').push(billboard);
    },

    /** Forget every pooled sprite (the collection is being destroyed). */
    clear() {
      free.clear();
    },
  };
}
