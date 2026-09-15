import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    applyNightlyVersion,
    buildNightlyVersion,
    parseArguments,
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
            ]),
            {
                apply: true,
                base: '0.23.0',
                date: '20260915',
                runNumber: '12',
            }
        );
    });

    it('reports usage for unknown flags and missing values', () => {
        assert.equal(parseArguments(['--unknown']), null);
        assert.equal(parseArguments(['--base']), null);
        assert.equal(parseArguments(['--base', '--apply']), null);
    });
});
