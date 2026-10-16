// Dependency-free entry for the DI tokens the web app's root shell and the
// eager Xtream data layer provide or inject. The main barrel would put every
// portal helper that lazy routes use onto the renderer's initial path.
export * from './lib/portal-external-playback';
export * from './lib/portal-playback-positions';
export * from './lib/portal-player';
export * from './lib/portal-shell-actions';
