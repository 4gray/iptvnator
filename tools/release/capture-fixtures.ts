/**
 * Fixture identities shared by the capture driver (seeding) and the named
 * setup actions (guide shots that re-enter the add-playlist dialog). Kept in
 * a leaf module so capture-navigation.ts can import them without pulling in
 * the driver, which itself imports the navigation module.
 *
 * Everything here is fictional and resolves only against the local Xtream
 * mock server; the G4 frame guard still rejects any URL carrying query
 * credentials, so the auto-detect hand-out deliberately uses labeled lines
 * instead of a `get.php?username=…` link.
 */

import { FICTIONAL_STALKER_MAC } from './screenshot-guards.mjs';

export const XTREAM_MOCK_ORIGIN = 'http://localhost:3211';
export const XTREAM_FIXTURE_TITLE = 'Fictional Xtream Demo';
export const M3U_FIXTURE_TITLE = 'release-demo';

export const STALKER_MOCK_ORIGIN = 'http://localhost:3210';
export const STALKER_FIXTURE_TITLE = 'Fictional Stalker Demo';
/** Reseller-panel shape most hand-outs use; discovery classifies the mock's answer itself. */
export const STALKER_FIXTURE_PORTAL_URL = `${STALKER_MOCK_ORIGIN}/portal.php`;
/** The mock's `marketing-demo` scenario; the only MAC the frame guard lets through. */
export const STALKER_FIXTURE_MAC = FICTIONAL_STALKER_MAC;

/** Credential pair of the mock server's curated `marketing` scenario. */
export const XTREAM_FIXTURE_CREDENTIALS = {
    username: 'marketing',
    password: 'marketing',
} as const;

/** Fictional playlist and guide addresses typed into forms for the M3U guide shots; never fetched. */
export const M3U_FIXTURE_PLAYLIST_URL = `${XTREAM_MOCK_ORIGIN}/demo/channels.m3u8`;
export const M3U_FIXTURE_PLAYLIST_TITLE = 'Fictional TV playlist';
export const EPG_FIXTURE_URL = `${XTREAM_MOCK_ORIGIN}/demo/guide.xml.gz`;

/** A fictional "your subscription is ready" message for the Auto-detect shot. */
export const AUTO_DETECT_FIXTURE_MESSAGE = [
    'Welcome to Fictional TV! Your account is ready.',
    '',
    `Host: ${XTREAM_MOCK_ORIGIN}`,
    `Username: ${XTREAM_FIXTURE_CREDENTIALS.username}`,
    `Password: ${XTREAM_FIXTURE_CREDENTIALS.password}`,
    '',
    'Use these details in any Xtream Codes compatible player.',
].join('\n');
