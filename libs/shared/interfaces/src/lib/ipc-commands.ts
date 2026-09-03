// EPG related commands
export const EPG_FETCH = 'EPG:FETCH';
export const EPG_FETCH_DONE = 'EPG:FETCH_DONE';
export const EPG_ERROR = 'EPG:ERROR';
export const EPG_GET_CHANNELS = 'EPG:GET_CHANNELS';
export const EPG_GET_CHANNELS_DONE = 'EPG:GET_CHANNELS_DONE';
export const EPG_GET_CHANNELS_BY_RANGE = 'EPG:EPG_GET_CHANNELS_BY_RANGE';
export const EPG_GET_CHANNELS_BY_RANGE_RESPONSE =
    'EPG:EPG_GET_CHANNELS_BY_RANGE_RESPONSE';
export const EPG_FORCE_FETCH = 'EPG:EPG_FORCE_FETCH';

// Playlist related commands
export const PLAYLIST_PARSE_BY_URL = 'PLAYLIST:PARSE_PLAYLIST_BY_URL';
export const PLAYLIST_UPDATE = 'PLAYLIST:UPDATE';
export const PLAYLIST_REFRESH = 'PLAYLIST:REFRESH';
export const PLAYLIST_REFRESH_EVENT = 'PLAYLIST:REFRESH_EVENT';
export const PLAYLIST_CANCEL_REFRESH = 'PLAYLIST:CANCEL_REFRESH';

// General
export const ERROR = 'ERROR';
/**
 * Main -> renderer push carrying an `ElectronBridgePlaylistOpenRequest`: a
 * playlist file the OS asked the app to open, either before the window existed
 * (first launch with a path argument) or while it was already running (second
 * launch, macOS `open-file`). This is the only channel requests leave the
 * main-process queue through.
 */
export const OPEN_FILE = 'OPEN_FILE';
/**
 * Renderer -> main invoke announcing that an `OPEN_FILE` listener is attached.
 * Carries no payload: it only tells the queue where to push.
 */
export const ANNOUNCE_PLAYLIST_OPEN_LISTENER =
    'announce-playlist-open-listener';
/**
 * Renderer -> main invoke confirming a pushed request was received. Until it
 * arrives the request stays in the queue, so a renderer that reloads or dies
 * mid-delivery gets it replayed instead of losing it.
 */
export const ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST =
    'acknowledge-playlist-open-request';

// Views
export const VIEW_SETTINGS = 'VIEW:SETTINGS';
export const VIEW_ADD_PLAYLIST = 'VIEW:PLAYLISTS';

// Auto-update
export const AUTO_UPDATE_PLAYLISTS = 'AUTO_UPDATE';
export const AUTO_UPDATE_PLAYLISTS_RESPONSE = 'AUTO_UPDATE_RESPONSE';

// Application updates
export const APP_UPDATE_GET_STATUS = 'APP_UPDATE:GET_STATUS';
export const APP_UPDATE_CHECK = 'APP_UPDATE:CHECK';
export const APP_UPDATE_DOWNLOAD = 'APP_UPDATE:DOWNLOAD';
export const APP_UPDATE_INSTALL = 'APP_UPDATE:INSTALL';
export const APP_UPDATE_GET_RELEASE_NOTES = 'APP_UPDATE:GET_RELEASE_NOTES';
export const APP_UPDATE_STATUS_CHANGED = 'APP_UPDATE:STATUS_CHANGED';

// Experimental
export const OPEN_MPV_PLAYER = 'OPEN_MPV_PLAYER';
export const SET_MPV_PLAYER_PATH = 'SET_MPV_PLAYER_PATH';
export const SET_MPV_REUSE_INSTANCE = 'SET_MPV_REUSE_INSTANCE';
export const OPEN_VLC_PLAYER = 'OPEN_VLC_PLAYER';
export const SET_VLC_PLAYER_PATH = 'SET_VLC_PLAYER_PATH';
export const SET_VLC_REUSE_INSTANCE = 'SET_VLC_REUSE_INSTANCE';
export const CLOSE_EXTERNAL_PLAYER_SESSION = 'CLOSE_EXTERNAL_PLAYER_SESSION';
export const EXTERNAL_PLAYER_SESSION_UPDATE = 'EXTERNAL_PLAYER_SESSION_UPDATE';
export const EMBEDDED_MPV_SUPPORT = 'EMBEDDED_MPV_SUPPORT';
export const EMBEDDED_MPV_CREATE_SESSION = 'EMBEDDED_MPV_CREATE_SESSION';
export const EMBEDDED_MPV_LOAD_PLAYBACK = 'EMBEDDED_MPV_LOAD_PLAYBACK';
export const EMBEDDED_MPV_SET_BOUNDS = 'EMBEDDED_MPV_SET_BOUNDS';
export const EMBEDDED_MPV_SET_PAUSED = 'EMBEDDED_MPV_SET_PAUSED';
export const EMBEDDED_MPV_SEEK = 'EMBEDDED_MPV_SEEK';
export const EMBEDDED_MPV_SEEK_BY = 'EMBEDDED_MPV_SEEK_BY';
export const EMBEDDED_MPV_SET_VOLUME = 'EMBEDDED_MPV_SET_VOLUME';
export const EMBEDDED_MPV_SET_AUDIO_TRACK = 'EMBEDDED_MPV_SET_AUDIO_TRACK';
export const EMBEDDED_MPV_SET_SUBTITLE_TRACK =
    'EMBEDDED_MPV_SET_SUBTITLE_TRACK';
export const EMBEDDED_MPV_ADD_SUBTITLE = 'EMBEDDED_MPV_ADD_SUBTITLE';
export const EMBEDDED_MPV_SET_SUBTITLE_DELAY =
    'EMBEDDED_MPV_SET_SUBTITLE_DELAY';
export const EMBEDDED_MPV_SET_SUBTITLE_STYLE =
    'EMBEDDED_MPV_SET_SUBTITLE_STYLE';
export const EMBEDDED_MPV_SELECT_SUBTITLE_FILE =
    'EMBEDDED_MPV_SELECT_SUBTITLE_FILE';
export const EMBEDDED_MPV_SET_SPEED = 'EMBEDDED_MPV_SET_SPEED';
export const EMBEDDED_MPV_SET_ASPECT = 'EMBEDDED_MPV_SET_ASPECT';
export const EMBEDDED_MPV_START_RECORDING = 'EMBEDDED_MPV_START_RECORDING';
export const EMBEDDED_MPV_STOP_RECORDING = 'EMBEDDED_MPV_STOP_RECORDING';
export const EMBEDDED_MPV_GET_DEFAULT_RECORDING_FOLDER =
    'EMBEDDED_MPV_GET_DEFAULT_RECORDING_FOLDER';
export const EMBEDDED_MPV_SELECT_RECORDING_FOLDER =
    'EMBEDDED_MPV_SELECT_RECORDING_FOLDER';
export const EMBEDDED_MPV_DISPOSE_SESSION = 'EMBEDDED_MPV_DISPOSE_SESSION';
export const EMBEDDED_MPV_SESSION_UPDATE = 'EMBEDDED_MPV_SESSION_UPDATE';
export const EMBEDDED_MPV_PREPARE = 'EMBEDDED_MPV_PREPARE';
export const EMBEDDED_MPV_GET_FRAME_SOURCE = 'EMBEDDED_MPV_GET_FRAME_SOURCE';
export const EMBEDDED_MPV_FRAME_SOURCE_CHANGED =
    'EMBEDDED_MPV_FRAME_SOURCE_CHANGED';

// Xtream
export const XTREAM_REQUEST = 'XTREAM_REQUEST';
export const XTREAM_RESPONSE = 'XTREAM_RESPONSE';
export const XTREAM_CANCEL_SESSION = 'XTREAM_CANCEL_SESSION';

// Stalker
export const STALKER_REQUEST = 'STALKER_REQUEST';
export const STALKER_RESPONSE = 'STALKER_RESPONSE';
export const PORTAL_DEBUG_EVENT = 'PORTAL_DEBUG_EVENT';

/**
 * Forgets the main process' recorded connection failures for a portal host, so
 * the next request contacts it for real. Sent whenever the user asks for a
 * fresh attempt (portal retry, "test connection") or hands over a possibly
 * different portal (endpoint discovery on import, edit, or lazy repair).
 */
export const CONNECTIVITY_GUARD_RESET = 'CONNECTIVITY_GUARD_RESET';

// Settings
export const SETTINGS_UPDATE = 'SETTINGS_UPDATE';
export const DELETE_ALL_PLAYLISTS = 'DELETE_ALL_PLAYLISTS';

// Remote Control
export const REMOTE_CONTROL_CHANGE_CHANNEL = 'REMOTE_CONTROL_CHANGE_CHANNEL';

// Display sleep: while a built-in video player is playing, the renderer asks
// the main process to hold a powerSaveBlocker so the screen stays awake
export const PLAYBACK_SET_KEEP_AWAKE = 'PLAYBACK:SET_KEEP_AWAKE';

// Window controls (custom title bar on Windows/Linux)
export const WINDOW_MINIMIZE = 'WINDOW:MINIMIZE';
export const WINDOW_TOGGLE_MAXIMIZE = 'WINDOW:TOGGLE_MAXIMIZE';
export const WINDOW_CLOSE = 'WINDOW:CLOSE';
export const WINDOW_GET_STATE = 'WINDOW:GET_STATE';
export const WINDOW_STATE_CHANGED = 'WINDOW:STATE_CHANGED';

// Close guard: while active, closing/quitting the app is intercepted in the
// main process and handed to the renderer for a save/discard/stay decision
export const WINDOW_SET_CLOSE_GUARD = 'WINDOW:SET_CLOSE_GUARD';
export const WINDOW_CONFIRM_CLOSE = 'WINDOW:CONFIRM_CLOSE';
export const WINDOW_CANCEL_CLOSE = 'WINDOW:CANCEL_CLOSE';
export const WINDOW_CLOSE_REQUESTED = 'WINDOW:CLOSE_REQUESTED';
