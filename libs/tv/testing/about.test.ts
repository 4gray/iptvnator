import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectTvPlatform,
    formatBuildTimestamp,
    tvDeveloperInfo,
    tvLicenceInfo,
} from '../feature/src/build-info';

test('About build fallbacks remain safe and readable', () => {
    assert.equal(formatBuildTimestamp('unknown'), 'unknown');
    assert.equal(formatBuildTimestamp('not-a-date'), 'unknown');
    assert.equal(
        formatBuildTimestamp('2026-10-29T14:22:08.483Z'),
        '2026-10-29 14:22:08 UTC'
    );
});

test('About platform detection reports only coarse runtime information', () => {
    assert.deepEqual(detectTvPlatform('Mozilla/5.0 webOS', false), {
        platform: 'LG webOS TV',
        runtime: 'Chromium-compatible webOS runtime',
    });
    assert.deepEqual(detectTvPlatform('Mozilla/5.0 Chrome/68', false), {
        platform: 'Browser runtime',
        runtime: 'Browser / Chromium-compatible runtime',
    });
    assert.equal(detectTvPlatform('', true).platform, 'LG webOS TV');
});

test('About developer and licence placeholders use verified repository information', () => {
    assert.equal(tvDeveloperInfo.name, 'Harsh Tiwar');
    assert.equal(tvDeveloperInfo.email, 'harsh.tiwar9@gmail.com');
    assert.equal(
        tvDeveloperInfo.website,
        'https://harshtiwar9.github.io/Resume/'
    );
    assert.equal(
        tvDeveloperInfo.support,
        'mailto:harsh.tiwar9@gmail.com'
    );
    assert.equal(tvLicenceInfo.licence, 'MIT License');
    assert.equal(tvLicenceInfo.copyright, 'Copyright (c) 2019-2026 4gray');
});
