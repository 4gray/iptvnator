import { SettingsFormWrites } from './settings-form-writes';

const saved = 'https://example.test/saved.xml';
const staged = 'https://example.test/staged.xml';
const imported = 'https://example.test/imported.xml';

describe('SettingsFormWrites', () => {
    it.each([false, true])(
        'merges only committed outside guides (import succeeds: %s)',
        (importSucceeds) => {
            const writes = new SettingsFormWrites();
            const patch = { epgUrl: [saved, staged] };
            const [{ mergeEpgUrls }] = writes.prepare(
                1,
                patch.epgUrl,
                patch,
                [saved],
                [saved, imported],
                false
            );
            expect(
                mergeEpgUrls?.(importSucceeds ? [saved, imported] : [saved])
            ).toEqual(
                importSucceeds ? [saved, staged, imported] : [saved, staged]
            );
        }
    );

    it('retains a saved source through a pending removal and failed write', () => {
        const writes = new SettingsFormWrites();
        const [, persisted] = writes.prepare(
            1,
            [saved, staged],
            { epgUrl: [saved, staged] },
            [saved],
            [saved],
            false
        );
        persisted?.();
        writes.prepare(
            2,
            [saved],
            { epgUrl: [saved] },
            [saved],
            [saved, staged],
            false
        );
        writes.rebase([saved], [saved]);
        writes.reject(2);
        expect(writes.knownUrls([saved])).toContain(staged);
    });
});
