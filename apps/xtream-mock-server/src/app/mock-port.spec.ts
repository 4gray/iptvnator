import { marketingAssetUrl } from './generators/marketing.generator.js';

// The generator module pulls in faker (ESM-only under this CJS Jest setup)
// through its sibling generators; `marketingAssetUrl` never calls it, so an
// empty stub keeps the import resolvable — same pattern as server.spec.ts.
jest.mock('@faker-js/faker', () => ({ faker: {} }));
import {
    DEFAULT_XTREAM_MOCK_PORT,
    resolveXtreamMockPortString,
} from './mock-port.js';

describe('resolveXtreamMockPortString', () => {
    it('prefers PORT, then the Playwright-side XTREAM_MOCK_PORT alias, then the default', () => {
        expect(resolveXtreamMockPortString({})).toBe(
            String(DEFAULT_XTREAM_MOCK_PORT)
        );
        expect(resolveXtreamMockPortString({ XTREAM_MOCK_PORT: '3311' })).toBe(
            '3311'
        );
        expect(
            resolveXtreamMockPortString({
                PORT: '3221',
                XTREAM_MOCK_PORT: '3311',
            })
        ).toBe('3221');
    });
});

describe('marketing asset origin', () => {
    const saved = {
        PORT: process.env['PORT'],
        XTREAM_MOCK_PORT: process.env['XTREAM_MOCK_PORT'],
    };

    const setEnvironment = (values: Record<string, string | undefined>) => {
        for (const key of ['PORT', 'XTREAM_MOCK_PORT'] as const) {
            if (values[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = values[key];
            }
        }
    };

    afterEach(() => setEnvironment(saved));

    it('mints asset URLs on the same port the listener resolves', () => {
        // A run relocated through the Playwright alias alone: the fixture's
        // poster/backdrop/logo/episode URLs must follow the bound port, or
        // the images load from another worktree's server (or nothing).
        setEnvironment({ PORT: undefined, XTREAM_MOCK_PORT: '3311' });
        expect(marketingAssetUrl('poster', 'Aurora News', '300x450')).toMatch(
            /^http:\/\/localhost:3311\/assets\/marketing\/poster\//
        );

        setEnvironment({ PORT: '3221', XTREAM_MOCK_PORT: '3311' });
        expect(
            marketingAssetUrl('backdrop', 'Aurora News', '1280x720')
        ).toMatch(/^http:\/\/localhost:3221\/assets\/marketing\/backdrop\//);

        setEnvironment({ PORT: undefined, XTREAM_MOCK_PORT: undefined });
        expect(marketingAssetUrl('logo', 'Aurora News', '256x256')).toMatch(
            new RegExp(
                `^http://localhost:${DEFAULT_XTREAM_MOCK_PORT}/assets/marketing/logo/`
            )
        );
    });
});
