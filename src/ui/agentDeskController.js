import { createFieldKitExecutor, needsWrites } from '../fieldkit/executor.js';

/** Session-only memory of the toggle; never localStorage, never the server. */
export const AGENT_WRITES_KEY = 'aurel.agent-writes.v1';
const RELAY = '/api/agent-desk';
const START_DELAY_MS = 3000;
const RETRY_MS = 5000;
const MISSING_RELAY_RETRY_MS = 60000;
const ACTIVITY_ROWS = 5;
const SESSION_ID_BYTES = 18;

function newSessionId() {
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The owner's agent desk in this tab: the "Allow agent writes" toggle (off by
 * default, remembered for this browser session only) and the long-poll that
 * answers Field Kit requests from a local MCP server. Requests are executed
 * by src/fieldkit/executor.js, which refuses every write while the toggle is
 * off. The controller publishes a plain view; it never renders.
 */
export class AgentDeskController {
  constructor({
    store,
    fieldbook,
    watchlists = null,
    capture = null,
    has,
    onWrite = () => {},
    fetchImpl = (...args) => globalThis.fetch(...args),
    storage,
    sleep = abortableSleep,
    now = Date.now,
    startDelayMs = START_DELAY_MS,
  }) {
    this.store = store;
    this._fetch = fetchImpl;
    this._storage = storage;
    this._sleep = sleep;
    this._now = now;
    this._startDelayMs = startDelayMs;
    this._session = newSessionId();
    this._abort = new AbortController();
    this._writesAllowed = this._readToggle();
    this._connected = false;
    this._activity = [];
    this._owner = null;
    this._executor = createFieldKitExecutor({
      fieldbook,
      watchlists,
      capture,
      has,
      now,
      onWrite,
    });
  }

  _sessionStorage() {
    return this._storage === undefined
      ? globalThis.sessionStorage
      : this._storage;
  }
  _readToggle() {
    try {
      return this._sessionStorage()?.getItem(AGENT_WRITES_KEY) === 'on';
    } catch {
      return false;
    }
  }
  _writeToggle(value) {
    try {
      const storage = this._sessionStorage();
      if (value) storage?.setItem(AGENT_WRITES_KEY, 'on');
      else storage?.removeItem(AGENT_WRITES_KEY);
    } catch {
      // Without session storage the toggle still holds for this page.
    }
  }

  /** Connect the view's control and start answering the relay. */
  init() {
    if (this._owner) return;
    this._owner = this.store.connect({
      setWritesAllowed: (value) => this.setWritesAllowed(value),
    });
    this._publish();
    this._running = this._loop();
  }

  get writesAllowed() {
    return this._writesAllowed;
  }

  setWritesAllowed(value) {
    this._writesAllowed = value === true;
    this._writeToggle(this._writesAllowed);
    this._publish();
    return this._writesAllowed;
  }

  _publish() {
    if (!this._owner || this._abort.signal.aborted) return;
    this.store.publish({
      writesAllowed: this._writesAllowed,
      connected: this._connected,
      activity: this._activity.map((row) => ({ ...row })),
    });
  }

  _record(request, answer) {
    const writing = needsWrites(request?.op, request?.args);
    const row = {
      op: String(request?.op ?? 'unknown').slice(0, 64),
      client: String(request?.client ?? 'unknown-client').slice(0, 32),
      outcome: answer.ok ? (writing ? 'written' : 'answered') : 'refused',
      code: answer.ok ? null : answer.refusal.code,
      at: new Date(this._now()).toISOString(),
    };
    this._activity = [row, ...this._activity].slice(0, ACTIVITY_ROWS);
    this._publish();
  }

  /** Answer one relayed request. Exposed for tests. */
  async handle(request) {
    const answer = await this._executor.execute(request, {
      writesAllowed: this._writesAllowed,
    });
    this._record(request, answer);
    return answer;
  }

  _setConnected(value) {
    if (this._connected === value) return;
    this._connected = value;
    this._publish();
  }

  async _pollOnce(signal) {
    const response = await this._fetch(
      `${RELAY}/next?session=${this._session}`,
      { signal, cache: 'no-store' },
    );
    if (response.status === 204) {
      this._setConnected(true);
      return 0;
    }
    if (!response.ok) {
      this._setConnected(false);
      return response.status === 404 ? MISSING_RELAY_RETRY_MS : RETRY_MS;
    }
    this._setConnected(true);
    const request = await response.json();
    const answer = await this.handle(request);
    await this._fetch(`${RELAY}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this._session, id: request.id, answer }),
      signal,
    });
    return 0;
  }

  async _loop() {
    const { signal } = this._abort;
    await this._sleep(this._startDelayMs, signal);
    while (!signal.aborted) {
      let wait;
      try {
        wait = await this._pollOnce(signal);
      } catch {
        if (signal.aborted) break;
        this._setConnected(false);
        wait = RETRY_MS;
      }
      if (wait > 0) await this._sleep(wait, signal);
    }
  }

  /** Stop polling and release the view's control. Idempotent. */
  destroy() {
    if (this._abort.signal.aborted) return;
    this._abort.abort();
    if (this._owner) this.store.detach(this._owner);
    this._owner = null;
  }
}
