import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    applyNightlyPublishChannel,
    applyNightlyVersion,
    buildNightlyVersion,
    isNightlyVersion,
    parseArguments,
    parseBooleanFlag,
} from './nightly-version.mjs';

describe('buildNightlyVersion', () => {
    it('bumps the patch and appends the nightly identifiers', () => {
        assert.equal(
            buildNightlyVersion({
                baseVersion: '0.23.0',
                date: '20260915',
                runNumber: '1234',
            }),
            '0.23.1-nightly.20260915.1234'
        );
    });

    it('orders newer nightlies above older ones and below the next stable', () => {
        const semverOrder = (left, right) => {
            // Mirror semver precedence closely enough for these shapes:
            // numeric identifiers compare numerically, a release outranks
            // its prereleases.
            const parse = (value) => {
                const [core, prerelease = ''] = value.split('-');
                return {
                    core: core.split('.').map(Number),
                    prerelease: prerelease ? prerelease.split('.') : [],
                };
            };
            const a = parse(left);
            const b = parse(right);
            for (let index = 0; index < 3; index += 1) {
                if (a.core[index] !== b.core[index]) {
                    return a.core[index] - b.core[index];
                }
            }
            if (a.prerelease.length === 0 || b.prerelease.length === 0) {
                return b.prerelease.length - a.prerelease.length;
            }
            for (let index = 0; index < a.prerelease.length; index += 1) {
                const x = a.prerelease[index];
                const y = b.prerelease[index];
                if (x === y) continue;
                return /^\d+$/.test(x) && /^\d+$/.test(y)
                    ? Number(x) - Number(y)
                    : x < y
                      ? -1
                      : 1;
            }
            return 0;
        };

        const older = buildNightlyVersion({
            baseVersion: '0.23.0',
            date: '20260915',
            runNumber: 1234,
        });
        const sameDayLater = buildNightlyVersion({
            baseVersion: '0.23.0',
            date: '20260915',
            runNumber: 1240,
        });
        const nextDay = buildNightlyVersion({
            baseVersion: '0.23.0',
            date: '20260916',
            runNumber: 1241,
        });

        assert.ok(semverOrder(older, '0.23.0') > 0);
        assert.ok(semverOrder(sameDayLater, older) > 0);
        assert.ok(semverOrder(nextDay, sameDayLater) > 0);
        assert.ok(semverOrder(nextDay, '0.23.1') < 0);
        assert.ok(semverOrder(nextDay, '0.24.0') < 0);
    });

    it('keeps the base patch while the base version is not tagged yet', () => {
        // The release-cut commit bumps package.json to 0.23.1 before the
        // v0.23.1 tag exists: the nightly must sit BELOW 0.23.1 so the
        // imminent stable release is still offered.
        assert.equal(
            buildNightlyVersion({
                baseVersion: '0.23.1',
                date: '20260915',
                runNumber: 1240,
                baseReleased: false,
            }),
            '0.23.1-nightly.20260915.1240'
        );
        assert.equal(
            buildNightlyVersion({
                baseVersion: '0.23.1',
                date: '20260915',
                runNumber: 1241,
                baseReleased: true,
            }),
            '0.23.2-nightly.20260915.1241'
        );
    });

    it('rejects a base version that is already a prerelease', () => {
        assert.throws(
            () =>
                buildNightlyVersion({
                    baseVersion: '0.23.1-nightly.20260915.1',
                    date: '20260915',
                    runNumber: 2,
                }),
            /released X\.Y\.Z version/
        );
    });

    it('rejects malformed dates and run numbers', () => {
        assert.throws(
            () =>
                buildNightlyVersion({
                    baseVersion: '0.23.0',
                    date: '2026-09-15',
                    runNumber: 1,
                }),
            /YYYYMMDD/
        );
        assert.throws(
            () =>
                buildNightlyVersion({
                    baseVersion: '0.23.0',
                    date: '20260915',
                    runNumber: undefined,
                }),
            /positive integer/
        );
        assert.throws(
            () =>
                buildNightlyVersion({
                    baseVersion: '0.23.0',
                    date: '20260915',
                    runNumber: '0',
                }),
            /positive integer/
        );
    });
});

describe('applyNightlyVersion', () => {
    it('replaces only the version line and keeps the file formatting', () => {
        const source =
            '{\n    "name": "iptvnator",\n    "version": "0.23.0",\n    "engines": {\n        "node": "22"\n    }\n}\n';

        assert.equal(
            applyNightlyVersion(source, '0.23.1-nightly.20260915.7'),
            '{\n    "name": "iptvnator",\n    "version": "0.23.1-nightly.20260915.7",\n    "engines": {\n        "node": "22"\n    }\n}\n'
        );
    });

    it('fails when the version line is missing', () => {
        assert.throws(
            () => applyNightlyVersion('{ "name": "x" }', '1.0.1-nightly.1.1'),
            /no "version" line/
        );
    });
});

describe('applyNightlyPublishChannel', () => {
    it('sets the github publish channel and keeps the rest of the config', () => {
        const source = JSON.stringify(
            {
                appId: 'x',
                publish: [{ provider: 'github', owner: '4gray', repo: 'iptvnator' }],
                mac: { target: ['dmg'] },
            },
            null,
            4
        );

        const result = applyNightlyPublishChannel(source);

        assert.deepEqual(JSON.parse(result), {
            appId: 'x',
            publish: [
                {
                    provider: 'github',
                    owner: '4gray',
                    repo: 'iptvnator',
                    channel: 'nightly',
                },
            ],
            mac: { target: ['dmg'] },
        });
        assert.ok(result.endsWith('}\n'));
        assert.match(result, /^\{\n {4}"appId"/);
    });

    it('applies to the repository config as committed', () => {
        const committed = readFileSync(
            new URL('../../electron-builder.json', import.meta.url),
            'utf8'
        );

        assert.equal(
            JSON.parse(applyNightlyPublishChannel(committed)).publish[0].channel,
            'nightly'
        );
    });

    it('refuses a config without a github publish provider', () => {
        assert.throws(
            () => applyNightlyPublishChannel('{"publish":[{"provider":"generic"}]}'),
            /github publish provider/
        );
        assert.throws(
            () => applyNightlyPublishChannel('{}'),
            /github publish provider/
        );
    });
});

describe('explicit version input', () => {
    it('accepts only the shape the script itself produces', () => {
        assert.equal(isNightlyVersion('0.23.1-nightly.20260915.1234'), true);
        assert.equal(isNightlyVersion('0.23.1'), false);
        assert.equal(isNightlyVersion('0.23.1-beta.1'), false);
        assert.equal(isNightlyVersion('0.23.1-nightly.2026915.1'), false);
        assert.equal(isNightlyVersion(undefined), false);
    });

    it('parses the base-released flag strictly', () => {
        assert.equal(parseBooleanFlag('true', '--base-released'), true);
        assert.equal(parseBooleanFlag('false', '--base-released'), false);
        assert.throws(
            () => parseBooleanFlag('yes', '--base-released'),
            /--base-released must be "true" or "false"/
        );
    });
});

describe('parseArguments', () => {
    it('reads the flags and ignores a bare separator', () => {
        assert.deepEqual(
            parseArguments([
                '--',
                '--apply',
                '--base',
                '0.23.0',
                '--date',
                '20260915',
                '--run-number',
                '12',
                '--base-released',
                'false',
                '--version',
                '0.23.0-nightly.20260915.12',
            ]),
            {
                apply: true,
                base: '0.23.0',
                date: '20260915',
                runNumber: '12',
                baseReleased: 'false',
                version: '0.23.0-nightly.20260915.12',
            }
        );
    });

    it('reports usage for unknown flags and missing values', () => {
        assert.equal(parseArguments(['--unknown']), null);
        assert.equal(parseArguments(['--base']), null);
        assert.equal(parseArguments(['--base', '--apply']), null);
    });
});
