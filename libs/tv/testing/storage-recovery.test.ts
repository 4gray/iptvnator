import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserDataRepository } from '@iptvnator/tv/data-access';
import { initialData } from '@iptvnator/tv/util';

test('failed initial reads forbid writes until the existing snapshot is recovered', async () => {
    let saved = {
        ...initialData(),
        activeId: 'existing',
        backend: 'https://saved.invalid',
    };
    let fail = true;
    let writes = 0;
    const repo = new UserDataRepository(
        {
            read: async () => {
                if (fail) throw new Error('read unavailable');
                return saved;
            },
            write: async (data) => {
                saved = data;
                writes++;
            },
        },
        () => undefined
    );
    await assert.rejects(repo.update((d) => ({ ...d, layout: 'shelf' })));
    await assert.rejects(repo.load());
    await assert.rejects(repo.update((d) => ({ ...d, layout: 'shelf' })));
    assert.equal(writes, 0);
    assert.equal(saved.activeId, 'existing');
    fail = false;
    await repo.load();
    await repo.update((d) => ({ ...d, layout: 'shelf' }));
    assert.equal(writes, 1);
    assert.equal(saved.activeId, 'existing');
    assert.equal(saved.backend, 'https://saved.invalid');
});

test('pending initial reads do not admit writes based on empty defaults', async () => {
    let finish!: (value: ReturnType<typeof initialData>) => void;
    const read = new Promise<ReturnType<typeof initialData>>((resolve) => {
        finish = resolve;
    });
    let writes = 0;
    const repo = new UserDataRepository(
        {
            read: () => read,
            write: async () => {
                writes++;
            },
        },
        () => undefined
    );
    const loading = repo.load();
    await assert.rejects(repo.update((d) => d));
    finish({ ...initialData(), activeId: 'kept' });
    await loading;
    assert.equal(writes, 0);
    assert.equal(repo.data.activeId, 'kept');
});
