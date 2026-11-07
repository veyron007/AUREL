/**
 * Slots for Field Kit tools other work packages deliver. A slot is
 * documentation and a registration point, never an implementation. Kept free
 * of imports so the app can read it without the MCP tool definitions.
 */
export const FIELD_KIT_SLOTS = Object.freeze([
  Object.freeze({
    name: 'horizon_at',
    owner: 'WP1 Kshitij Horizon Engine',
    status: 'pending',
    note: 'Pass its tool definition as createFieldKitTools({ horizonAt }) once WP1 merges.',
  }),
]);
