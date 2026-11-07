/**
 * The agent desk relay: the local meeting point between MCP Field Kit tools
 * and the owner's open AUREL tab. The Fieldbook and Watchlists live in the
 * tab's IndexedDB, and the "Allow agent writes" toggle lives in the tab's
 * session, so the MCP server cannot write them itself. It submits a request
 * here; the tab long-polls for requests, decides (refusing while writes are
 * off), and posts its answer back.
 *
 * In memory only: nothing is persisted, nothing runs when no tab polls, and a
 * request no tab answers in time gets a typed `timeout` refusal. This module
 * never interprets a request; the tab validates everything again.
 */

import { randomUUID } from 'node:crypto';
import { isRefusal } from '../../src/fieldkit/refusals.js';

export const RELAY_DEFAULTS = Object.freeze({
  /** How long a write waits for the tab to answer. */
  requestTimeoutMs: 20_000,
  /** render_view waits for a fresh frame and a PNG encode. */
  renderTimeoutMs: 30_000,
  /** A tab that has not polled within this window is gone. */
  presenceMs: 35_000,
  /** How long one poll is held open before an empty answer. */
  pollMs: 25_000,
  /** Requests waiting at once; more are refused, never queued unbounded. */
  maxPending: 32,
});

export const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

const refusal = (code, message) => ({
  ok: false,
  refusal: { code, message, details: null },
});

/** Whether an answer from the tab has the shape the tools accept. */
export function isRelayAnswer(answer) {
  if (!answer || typeof answer !== 'object') return false;
  if (answer.ok === true)
    return Boolean(answer.result) && typeof answer.result === 'object';
  return answer.ok === false && isRefusal(answer.refusal);
}

export function createAgentDeskRelay({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  ...overrides
} = {}) {
  const options = { ...RELAY_DEFAULTS, ...overrides };
  const sessions = new Map();
  const queue = [];
  const taken = new Map();
  const pollers = [];

  const present = () => {
    const cutoff = now() - options.presenceMs;
    for (const [id, seen] of sessions) if (seen < cutoff) sessions.delete(id);
    return sessions.size > 0 || pollers.length > 0;
  };

  function settle(entry, answer) {
    if (entry.settled) return;
    entry.settled = true;
    clearTimer(entry.timer);
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    taken.delete(entry.id);
    entry.resolve(answer);
  }

  function dispatch() {
    while (queue.length && pollers.length) {
      const entry = queue.shift();
      const poller = pollers.shift();
      clearTimer(poller.timer);
      taken.set(entry.id, { entry, session: poller.session });
      poller.resolve({
        id: entry.id,
        op: entry.op,
        args: entry.args,
        client: entry.client,
      });
    }
  }

  function removePoller(poller) {
    const index = pollers.indexOf(poller);
    if (index < 0) return false;
    pollers.splice(index, 1);
    return true;
  }

  function submit({ op, args, client }, { signal } = {}) {
    if (!present())
      return Promise.resolve(
        refusal(
          'no_app_session',
          'No AUREL tab is open on this server. Open AUREL (npm run dev), then retry.',
        ),
      );
    if (queue.length + taken.size >= options.maxPending)
      return Promise.resolve(
        refusal(
          'timeout',
          'The app is busy with other agent requests; retry shortly.',
        ),
      );
    return new Promise((resolve) => {
      const entry = { id: randomUUID(), op, args, client, resolve };
      const wait =
        op === 'render_view'
          ? options.renderTimeoutMs
          : options.requestTimeoutMs;
      entry.timer = setTimer(
        () =>
          settle(
            entry,
            refusal(
              'timeout',
              'The AUREL tab did not answer in time. Check Library before retrying.',
            ),
          ),
        wait,
      );
      signal?.addEventListener('abort', () =>
        settle(entry, refusal('timeout', 'The request was cancelled.')),
      );
      queue.push(entry);
      dispatch();
    });
  }

  function poll(session, { signal } = {}) {
    if (!SESSION_ID.test(String(session))) return Promise.resolve(null);
    sessions.set(session, now());
    return new Promise((resolve) => {
      const poller = { session, resolve };
      poller.timer = setTimer(() => {
        if (removePoller(poller)) resolve(null);
      }, options.pollMs);
      signal?.addEventListener('abort', () => {
        if (!removePoller(poller)) return;
        clearTimer(poller.timer);
        resolve(null);
      });
      pollers.push(poller);
      dispatch();
    });
  }

  function complete(session, id, answer) {
    const held = taken.get(id);
    if (!held || held.session !== session) return false;
    sessions.set(session, now());
    settle(
      held.entry,
      isRelayAnswer(answer)
        ? answer
        : refusal('unsupported', 'The app returned an unreadable answer.'),
    );
    return true;
  }

  return Object.freeze({
    /** Submit one request; resolves to the tab's answer or a refusal. */
    submit,
    /** A tab asks for the next request; resolves to it or null. */
    poll,
    /** The tab that took a request answers it; other sessions cannot. */
    complete,
    /** Counts for diagnostics; never request contents. */
    stats() {
      present();
      return {
        sessions: sessions.size,
        waiting: queue.length,
        inFlight: taken.size,
        pollers: pollers.length,
      };
    },
  });
}
