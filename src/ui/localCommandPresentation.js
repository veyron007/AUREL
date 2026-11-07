import { t } from '../i18n/index.js';
export function localCommandReason(code) {
  return (
    {
      'blocked-input': t(
        'Use a supported command without links, scripts or provider credentials.',
      ),
      'untrusted-origin': t('Only commands typed here can run.'),
      'empty-command': t('Type a command to preview it.'),
      'unsupported-command': t(
        'This command is not supported. Try one of the examples.',
      ),
      'invalid-command': t('Check the command and preview it again.'),
      'invalid-coordinates': t(
        'Enter latitude from -90 to 90 and longitude from -180 to 180.',
      ),
      'prohibited-provider': t('This command cannot enable that provider.'),
      'no-active-project': t('Create or open a Fieldbook project first.'),
      'no-selected-place': t('Select a place in Lens first.'),
      'no-current-route': t('Create or restore a route first.'),
      'choose-available-dates': t(
        'Choose two verified acquisitions in Compare first.',
      ),
      'missing-evidence': t(
        'Save evidence in Fieldbook before opening a brief.',
      ),
      'context-changed': t(
        'Your selection changed. Preview the command again before running it.',
      ),
      'action-unavailable': t(
        'The action did not complete. Check its workspace for availability or unsaved changes.',
      ),
    }[code] || null
  );
}
export function localCommandLabel(type) {
  return (
    {
      fly_to_location: t('Navigate to coordinates'),
      search_places: t('Stage a place search'),
      set_layer_visibility: t('Change a free layer'),
      open_panel: t('Open a workspace'),
      save_project: t('Save the active project'),
      save_place: t('Save the selected place'),
      save_route: t('Capture and save the current route'),
      compare_selected: t('Compare the selected acquisitions'),
      brief_selected: t('Open the saved evidence brief'),
    }[type] || t('Command')
  );
}
export function localCommandStatus(view) {
  if (view?.status === 'completed') {
    if (view.proposal?.command?.type === 'search_places')
      return t(
        'Search staged. Review the query and submit it in the search tray.',
      );
    if (view.proposal?.command?.type === 'set_layer_visibility')
      return t('Visibility updated. Check the layer for data availability.');
    return t('Action confirmed by its owner.');
  }
  return (
    {
      running: t('Waiting for the action to finish…'),
      cancelled: t('Stopped waiting. Changes already completed are kept.'),
      preview: t('Review the action before running it.'),
      error: t('Command needs attention'),
    }[view?.status] || t('Nothing runs until you preview and choose Run.')
  );
}
