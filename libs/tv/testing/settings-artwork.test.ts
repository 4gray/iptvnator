import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStalkerArtwork } from '@iptvnator/portal/stalker/client';
import {
    applySettingsDraft,
    initialData,
    parseSettingsDraft,
    phoneSettingsDefaults,
} from '@iptvnator/tv/util';
test('Stalker artwork resolves root paths and falls through blank or unsupported fields', () => {
    const base = 'https://portal.example/stalker_portal/server/load.php';
    assert.equal(
        resolveStalkerArtwork(base, '', '/stalker_portal/screenshots/1.jpg'),
        'https://portal.example/stalker_portal/screenshots/1.jpg'
    );
    assert.equal(
        resolveStalkerArtwork(base, 'N/A', 'assets/poster.jpg'),
        'https://portal.example/assets/poster.jpg'
    );
    assert.equal(
        resolveStalkerArtwork(base, '//cdn.example/a.jpg'),
        'https://cdn.example/a.jpg'
    );
    assert.equal(
        resolveStalkerArtwork(
            base,
            'javascript:alert(1)',
            'data:image/png;base64,AA',
            'https://user:pass@host/a'
        ),
        undefined
    );
    assert.equal(
        resolveStalkerArtwork(base, 'https://cdn.example/a.jpg?size=300'),
        'https://cdn.example/a.jpg?size=300'
    );
});
test('phone settings defaults never export a key; blank replacement preserves it and unrelated TV data', () => {
    const data = initialData();
    data.tmdb.apiKey = 'existing-secret';
    const defaults = phoneSettingsDefaults(data);
    assert.equal(JSON.stringify(defaults).includes('existing-secret'), false);
    assert.equal(defaults.tmdb.hasKey, true);
    const next = applySettingsDraft(data, {
        ...defaults,
        layout: 'shelf',
        tmdb: { enabled: true, language: 'ru', apiKey: '  ' },
    });
    assert.equal(next.tmdb.apiKey, 'existing-secret');
    assert.equal(next.layout, 'shelf');
    assert.equal(next.sources, data.sources);
    assert.equal(next.positions, data.positions);
});
test('phone settings reject missing required key at commit, malformed values and oversized keys', () => {
    const value = {
        layout: 'cinema',
        epg: true,
        tmdb: { enabled: true, language: 'en' },
    };
    assert.throws(() => applySettingsDraft(initialData(), value));
    assert.throws(() => parseSettingsDraft({ ...value, epg: 'true' }));
    assert.throws(() =>
        parseSettingsDraft({
            ...value,
            tmdb: { ...value.tmdb, apiKey: 'x'.repeat(4097) },
        })
    );
    const next = applySettingsDraft(initialData(), {
        ...value,
        tmdb: { ...value.tmdb, apiKey: 'new-key' },
        backend: 'https://attacker.invalid',
    });
    assert.equal(next.tmdb.apiKey, 'new-key');
    assert.equal(next.backend, '');
});
