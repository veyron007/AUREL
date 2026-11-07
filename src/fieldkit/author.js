/**
 * Author tagging for entries an agent writes into the Fieldbook or Watchlists.
 *
 * The Fieldbook schema has no author field, and Phase 6 does not change it.
 * An agent-written entry carries its author in its stable ID instead:
 * `agent.<client>.<uuid>`. The client is the MCP client's own name from
 * `initialize` (for example `claude-code`), reduced to `[a-z0-9-]`. The time
 * is the entry's own `createdAt`. Library shows "by agent · <client> · time".
 *
 * The tag marks text as agent-written and untrusted; it grants nothing. A
 * forged tag in an imported backup only makes content look less trusted.
 */

export const AGENT_ID_PREFIX = 'agent';
const MAX_CLIENT_LENGTH = 32;
const UNKNOWN_CLIENT = 'unknown-client';
const AGENT_ID =
  /^agent\.([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)\.([0-9a-f-]{36})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A client name safe to store and show: lower case letters, digits and
 * single hyphens, at most 32 characters.
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeClientName(name) {
  const cleaned = String(typeof name === 'string' ? name : '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CLIENT_LENGTH)
    .replace(/-+$/g, '');
  return cleaned || UNKNOWN_CLIENT;
}

/**
 * A Fieldbook-valid stable ID that records the writing agent.
 * @param {string} client
 * @param {string} [uuid]
 * @returns {string}
 */
export function agentEntryId(client, uuid = globalThis.crypto?.randomUUID?.()) {
  if (typeof uuid !== 'string' || !UUID.test(uuid))
    throw new TypeError('Agent entry IDs need a random UUID');
  return `${AGENT_ID_PREFIX}.${sanitizeClientName(client)}.${uuid}`;
}

/**
 * The agent author an ID records, or null for owner-written entries.
 * @param {unknown} id
 * @returns {{ client: string } | null}
 */
export function parseAgentAuthor(id) {
  const match = typeof id === 'string' ? AGENT_ID.exec(id) : null;
  return match ? { client: match[1] } : null;
}

/**
 * The author parts Library shows for an entry, or null when the owner wrote
 * it. `time` is the entry's own creation time, unchanged.
 * @param {{ id?: string, createdAt?: string } | null | undefined} entry
 * @returns {{ client: string, time: string | null } | null}
 */
export function agentAuthorOf(entry) {
  const author = parseAgentAuthor(entry?.id);
  if (!author) return null;
  return {
    client: author.client,
    time: typeof entry.createdAt === 'string' ? entry.createdAt : null,
  };
}

/**
 * The plain English tag, used in tool answers and logs:
 * "by agent · claude-code · 2026-11-08T00:31:00.000Z".
 * @param {{ id?: string, createdAt?: string }} entry
 * @returns {string | null}
 */
export function agentAuthorLabel(entry) {
  const author = agentAuthorOf(entry);
  if (!author) return null;
  return `by agent · ${author.client} · ${author.time ?? 'time unknown'}`;
}
