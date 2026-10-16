/**
 * Lazy boundary for PlayerService: the service imports this file dynamically,
 * so the dialog and the @angular/forms it brings (via the Material checkbox)
 * stay off the initial path. The boundary is a local file rather than the
 * library path because other web files, such as specs, import ui-playback
 * statically, which @nx/enforce-module-boundaries forbids for a library the
 * project also loads dynamically.
 */
export { ExternalPlayerInfoDialogComponent } from '@iptvnator/ui/playback/external-player-info-dialog';
