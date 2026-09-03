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

export const XTREAM_MOCK_ORIGIN = 'http://localhost:3211';
export const XTREAM_FIXTURE_TITLE = 'Fictional Xtream Demo';
export const M3U_FIXTURE_TITLE = 'release-demo';

/** Credential pair of the mock server's curated `marketing` scenario. */
export const XTREAM_FIXTURE_CREDENTIALS = {
    username: 'marketing',
    password: 'marketing',
} as const;

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
