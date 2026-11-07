/**
 * Slots for Field Kit tools other work packages deliver. A slot is
 * documentation and a registration point, never an implementation. Kept free
 * of imports so the app can read it without the MCP tool definitions.
 */
export const FIELD_KIT_SLOTS = Object.freeze([
  Object.freeze({
    name: 'horizon_at',
    owner: 'WP1 Kshitij Horizon Engine',
    status: 'delivered',
    note: 'Delivered by WP1 as a core tool (src/tools/queries/horizon.js); the slot stays empty so the tool is offered once.',
  }),
]);
