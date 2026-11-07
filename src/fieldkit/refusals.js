/**
 * Typed refusals for Field Kit tools. A refusal is an expected answer, not a
 * crash: it names a stable code the agent can branch on, a sentence for the
 * person, and only the details that help the caller retry correctly.
 */

export const FIELD_KIT_REFUSAL_CODES = Object.freeze([
  /** The owner has not turned on "Allow agent writes" in this app session. */
  'writes_disabled',
  /** No AUREL tab is open and connected to this server. */
  'no_app_session',
  /** The Fieldbook project changed since the revision the agent named. */
  'revision_conflict',
  /** A drawn or watched area is not a valid, bounded geometry. */
  'invalid_geometry',
  /** The arguments name a project, place or template that does not exist. */
  'not_found',
  /** A local limit (projects, places, watches) has been reached. */
  'limit_reached',
  /** The request asks for something AUREL does not offer. */
  'unsupported',
  /** Local storage could not be read or written. */
  'storage_unavailable',
  /** The arguments do not match the tool's schema. */
  'invalid_request',
  /** The app did not answer in time. */
  'timeout',
]);

/**
 * @typedef {{ code: string, message: string, details: object | null }} FieldKitRefusal
 */

/**
 * A frozen refusal. Unknown codes throw, so a typo cannot reach an agent.
 * @param {string} code
 * @param {string} message
 * @param {object | null} [details]
 * @returns {FieldKitRefusal}
 */
export function createRefusal(code, message, details = null) {
  if (!FIELD_KIT_REFUSAL_CODES.includes(code))
    throw new TypeError(`Unknown Field Kit refusal: ${code}`);
  if (typeof message !== 'string' || !message)
    throw new TypeError('A refusal needs a message');
  return Object.freeze({
    code,
    message,
    details: details ? Object.freeze({ ...details }) : null,
  });
}

/** An error carrying a refusal, thrown inside write operations. */
export class FieldKitRefusalError extends Error {
  constructor(code, message, details = null) {
    const refusal = createRefusal(code, message, details);
    super(message);
    this.name = 'FieldKitRefusalError';
    this.refusal = refusal;
  }
}

/** Shape-check a refusal that crossed the relay from the app. */
export function isRefusal(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    FIELD_KIT_REFUSAL_CODES.includes(value.code) &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 1000
  );
}

/** The refusal every write tool answers while writes are off. */
export function writesDisabledRefusal() {
  return createRefusal(
    'writes_disabled',
    'Agent writes are off. The owner can turn on "Allow agent writes" in AUREL\'s workspace tools for this session; nothing was written.',
  );
}
