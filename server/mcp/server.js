/** The local MCP server: Core's tools over services backed by a running app. */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  composeCatalog,
  coreTools,
  catalogForSurface,
} from '../../src/tools/index.js';
import {
  createGlobePanelResource,
  panelRuntime,
} from '../../src/tools/panel.js';
import { createMcpServer } from '../../src/tools/mcp/index.js';
import { envelopeInterceptor } from '../../src/fieldkit/envelope.js';
import { createFieldKitTools } from '../../src/fieldkit/tools.js';
import { sanitizeClientName } from '../../src/fieldkit/author.js';
import { DEFAULT_API_BASE, createLocalToolServices } from './services.js';

const INSTRUCTIONS =
  "Tools answer questions from God's Eye View's live public data. Location " +
  'tools take an area: a place name, a bbox, or lat/lon with radius_km. ' +
  'Results are capped; check truncated and total before concluding there is nothing more. ' +
  "Answers that can be shown in God's Eye View include data.view; to show one, call " +
  'show_in_gods_eye_view with that view, adding layers, style, a camera or marks as ' +
  "needed. It shows live God's Eye View where the client displays apps and " +
  'returns a link everywhere. Every result carries a provenance envelope ' +
  '(observed, modelled, derived, simulated or note; sources, licence and ' +
  'applicable time); cite it. Field Kit tools write to the owner’s Fieldbook ' +
  'only while the owner has turned on "Allow agent writes" in the open AUREL ' +
  'tab; otherwise they answer a typed refusal. Call get_free_budget before ' +
  'provider-heavy work.';

/**
 * The tools the local MCP server composes: Core's, then the Field Kit's.
 * `horizonAt` is the Field Kit's slot for horizon_at. WP1 delivered that tool
 * as a core tool, so the slot stays null and the tool is offered once.
 */
export function localMcpTools({ horizonAt = null } = {}) {
  return [...coreTools, ...createFieldKitTools({ horizonAt })];
}

/** Construct the local MCP server for Core's and the Field Kit's tools. */
export function createLocalMcpServer({
  apiBase = DEFAULT_API_BASE,
  fetchImpl,
  panelKey = randomBytes(32).toString('base64url'),
  ledgerDir,
  horizonAt = null,
} = {}) {
  const { version } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  // Unless given one, each server makes a new key for its panel. The panel's
  // page carries it and panel_request requires it; any client may read the
  // page, so it keeps the tool from clients that only list it, and is not
  // access control. The stdio entry passes the install's shared key
  // (panelKey.js), so separate processes of one client agree.
  // The client's self-reported name tags Field Kit writes ("by agent ·
  // claude-code · time"). It is a label, not an identity.
  let clientName = 'unknown-client';
  return createMcpServer({
    catalog: catalogForSurface(
      composeCatalog({
        tools: localMcpTools({ horizonAt }),
        services: createLocalToolServices({
          apiBase,
          fetchImpl,
          panelKey,
          ledgerDir,
          clientName: () => clientName,
        }),
        interceptors: [envelopeInterceptor()],
      }),
      'mcp',
    ),
    onInitialize: (params) => {
      clientName = sanitizeClientName(params?.clientInfo?.name);
    },
    name: 'gods-eye-view',
    version,
    instructions: INSTRUCTIONS,
    resources: [createGlobePanelResource({ runtime: panelRuntime, panelKey })],
  });
}
