import {
    appUpdateReleasesApiUrl,
    appUpdateReleasesPageUrl,
    appUpdateRepository,
    appVersionChannel,
    compareAppVersions,
    normalizeAppUpdateChannel,
    parseAppVersion,
} from './app-update-channel.util';

describe('app update channel util', () => {
    it('collapses unknown channels to stable', () => {
        expect(normalizeAppUpdateChannel('nightly')).toBe('nightly');
        expect(normalizeAppUpdateChannel('stable')).toBe('stable');
        expect(normalizeAppUpdateChannel('canary')).toBe('stable');
        expect(normalizeAppUpdateChannel(undefined)).toBe('stable');
        expect(normalizeAppUpdateChannel(null)).toBe('stable');
    });

    it('maps each channel to its repository and pages', () => {
        expect(appUpdateRepository('stable')).toEqual({
            owner: '4gray',
            repo: 'iptvnator',
        });
        expect(appUpdateRepository('nightly')).toEqual({
            owner: '4gray',
            repo: 'iptvnator-nightly',
        });
        // /releases/latest never resolves to a prerelease.
        expect(appUpdateReleasesPageUrl('stable')).toBe(
            'https://github.com/4gray/iptvnator/releases/latest'
        );
        expect(appUpdateReleasesPageUrl('nightly')).toBe(
            'https://github.com/4gray/iptvnator-nightly/releases'
        );
        expect(appUpdateReleasesApiUrl('nightly')).toBe(
            'https://api.github.com/repos/4gray/iptvnator-nightly/releases'
        );
    });

    it('reads the channel a build belongs to off its version', () => {
        expect(appVersionChannel('0.23.0')).toBe('stable');
        expect(appVersionChannel('v0.23.0')).toBe('stable');
        expect(appVersionChannel('0.23.1-nightly.20260915.1234')).toBe(
            'nightly'
        );
        expect(appVersionChannel('v0.23.1-nightly.20260915.1234')).toBe(
            'nightly'
        );
        expect(appVersionChannel('0.23.1-beta.1')).toBe('stable');
        expect(appVersionChannel('junk')).toBe('stable');
        expect(appVersionChannel(undefined)).toBe('stable');
    });

    it('parses core and prerelease identifiers', () => {
        expect(parseAppVersion('v0.23.1-nightly.20260915.7+abc')).toEqual({
            core: [0, 23, 1],
            prerelease: ['nightly', '20260915', '7'],
        });
        expect(parseAppVersion('0.23')).toBeNull();
    });

    it('orders versions by semver precedence', () => {
        expect(compareAppVersions('0.24.0', '0.23.0')).toBe(1);
        expect(compareAppVersions('0.23.0', '0.23.0')).toBe(0);
        // A nightly sits between the released version and the next patch.
        expect(compareAppVersions('0.23.1-nightly.20260915.7', '0.23.0')).toBe(
            1
        );
        expect(compareAppVersions('0.23.1-nightly.20260915.7', '0.23.1')).toBe(
            -1
        );
        expect(compareAppVersions('0.23.1-nightly.20260915.7', '0.24.0')).toBe(
            -1
        );
        // Same day: the run number decides numerically, not lexically.
        expect(
            compareAppVersions(
                '0.23.1-nightly.20260915.1000',
                '0.23.1-nightly.20260915.999'
            )
        ).toBe(1);
        expect(
            compareAppVersions(
                '0.23.1-nightly.20260916.1',
                '0.23.1-nightly.20260915.999'
            )
        ).toBe(1);
        // Fewer identifiers rank lower; numeric identifiers rank below words.
        expect(compareAppVersions('0.23.1-nightly', '0.23.1-nightly.1')).toBe(
            -1
        );
        expect(compareAppVersions('0.23.1-1', '0.23.1-alpha')).toBe(-1);
        // Junk never looks like an update.
        expect(compareAppVersions('junk', '0.23.0')).toBe(0);
    });
});
