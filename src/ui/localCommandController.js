import {
  parseLocalCommand,
  validateLocalCommand,
} from '../localAssistant/commands.js';

const CONTEXT_KEYS = {
  save_place: ['selectionKey'],
  save_route: ['routeKey'],
  save_project: ['projectKey'],
  compare_selected: ['compareKey'],
  brief_selected: ['projectKey', 'evidenceKey'],
};
const signature = (command, context) =>
  JSON.stringify(
    (CONTEXT_KEYS[command.type] || []).map((key) => context[key] ?? null),
  );

/** Typed input only. Parsing is pure; existing owners perform explicit, awaited actions. */
export class LocalCommandController {
  constructor({
    readContext = () => ({}),
    execute = async () => false,
    store,
    publish = () => {},
  } = {}) {
    Object.assign(this, { readContext, execute, store, publish });
    this.input = '';
    this.proposal = null;
    this.status = 'empty';
    this.error = null;
    this.busy = false;
    this.destroyed = false;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect({
      setInput: (value) => this.setInput(value),
      preview: () => this.preview(),
      run: () => this.run(),
      cancel: () => this.cancel(),
      clear: () => this.clear(),
    });
    this.present();
  }
  live() {
    return (
      !this.destroyed &&
      (!this.store?.owns || this.store.owns(this.owner, 'run'))
    );
  }
  present() {
    if (!this.live()) return;
    const view = Object.freeze({
      input: this.input,
      proposal: this.proposal,
      status: this.status,
      error: this.error,
      busy: this.busy,
      canRun:
        !this.busy &&
        this.status === 'preview' &&
        this.proposal?.status === 'ready',
      canCancel: this.busy && this.status === 'running',
    });
    this.publish(view);
    this.store?.publish(view);
  }
  setInput(value) {
    if (!this.live() || this.busy) return false;
    this.input = typeof value === 'string' ? value.slice(0, 512) : '';
    this.proposal = null;
    this.error = null;
    this.status = this.input ? 'editing' : 'empty';
    this.present();
    return true;
  }
  clear() {
    return this.setInput('');
  }
  preview() {
    if (!this.live() || this.busy) return false;
    const context = { ...this.readContext(), origin: 'user' };
    this.proposal = parseLocalCommand(this.input, context);
    this.previewSignature = this.proposal.command
      ? signature(this.proposal.command, context)
      : null;
    this.error = this.proposal.reason;
    this.status = 'preview';
    this.present();
    return this.proposal.status === 'ready';
  }
  async run() {
    if (
      !this.live() ||
      this.busy ||
      this.status !== 'preview' ||
      this.proposal?.status !== 'ready'
    )
      return false;
    let command;
    try {
      const context = { ...this.readContext(), origin: 'user' };
      command = validateLocalCommand(this.proposal.command, context);
      if (signature(command, context) !== this.previewSignature)
        throw Object.assign(Error(), { code: 'context-changed' });
    } catch (error) {
      this.error = error.code || 'invalid-command';
      this.status = 'error';
      this.present();
      return false;
    }
    const request = new AbortController();
    this.request = request;
    this.busy = true;
    this.error = null;
    this.status = 'running';
    this.present();
    try {
      const result = await this.execute(command, { signal: request.signal });
      if (!this.live() || request.signal.aborted) return false;
      if (result !== true && result?.ok !== true)
        throw Error('Action did not complete');
      this.status = 'completed';
      return true;
    } catch {
      if (this.live() && !request.signal.aborted) {
        this.status = 'error';
        this.error = 'action-unavailable';
      }
      return false;
    } finally {
      this.busy = false;
      this.request = null;
      this.present();
    }
  }
  cancel() {
    if (!this.live() || !this.busy) return false;
    this.request?.abort();
    this.status = 'cancelled';
    this.error = null;
    this.present();
    return true;
  }
  destroy() {
    if (this.destroyed) return;
    this.request?.abort();
    this.destroyed = true;
    this.store?.detach(this.owner);
  }
}
