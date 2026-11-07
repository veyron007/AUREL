import { validateLocalCommand } from './commands.js';
function same(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
  );
}
/** Evaluate synthetic proposals only. A passing score never authorizes execution. */
export function gradeLocalProposal(proposal, { context = {}, expected } = {}) {
  if (
    !proposal ||
    typeof proposal !== 'object' ||
    Array.isArray(proposal) ||
    Object.keys(proposal).length !== 2 ||
    !Object.hasOwn(proposal, 'status') ||
    !Object.hasOwn(proposal, 'command') ||
    !['ready', 'needs-input', 'blocked', 'unsupported'].includes(
      proposal.status,
    )
  )
    return { valid: false, correct: false, reason: 'invalid-proposal' };
  try {
    if (proposal.status === 'ready')
      validateLocalCommand(proposal.command, { ...context, origin: 'model' });
    else if (proposal.command !== null) throw new Error('non-ready-command');
  } catch (error) {
    return {
      valid: false,
      correct: false,
      reason: error.code || 'invalid-command',
    };
  }
  return {
    valid: true,
    correct: same(proposal, expected),
    reason: same(proposal, expected) ? null : 'incorrect-intent',
  };
}
