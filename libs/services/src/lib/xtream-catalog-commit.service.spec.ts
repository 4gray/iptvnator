import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { XtreamCatalogCommitService } from './xtream-catalog-commit.service';

const playlist = {
    _id: 'synthetic-source',
    serverUrl: 'https://synthetic.invalid',
    username: 'fixture-user',
    password: 'fixture-password',
    userAgent: 'Fixture player',
} as PlaylistMeta;
const key = `xtream-import-status:${playlist._id}:movie`;
let descriptor: PropertyDescriptor | undefined;
let write: jest.Mock;
let check: jest.Mock;
beforeEach(() => {
    descriptor = Object.getOwnPropertyDescriptor(window, 'electron');
    write = jest
        .fn()
        .mockResolvedValue({ success: true, conditionChecked: true });
    check = jest
        .fn()
        .mockResolvedValue({ success: true, conditionChecked: true });
    Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { dbSetAppState: write, dbCheckXtreamCatalogConnection: check },
    });
});
afterEach(() => {
    if (descriptor) Object.defineProperty(window, 'electron', descriptor);
    else Reflect.deleteProperty(window, 'electron');
});

it('binds native completion and acknowledgment to the fetched connection', async () => {
    const service = new XtreamCatalogCommitService();
    await service.setState(playlist, key, 'completed');
    await service.setState(
        playlist,
        `xtream-history-recovery:${playlist._id}`,
        ''
    );
    expect(write).toHaveBeenCalledWith(key, 'completed', {
        playlistId: playlist._id,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        userAgent: playlist.userAgent,
    });
    expect(write).toHaveBeenCalledTimes(2);
});

it('reports a changed connection distinctly from storage failures', async () => {
    write.mockResolvedValue({
        success: false,
        conditionChecked: true,
        connectionChanged: true,
    });
    await expect(
        new XtreamCatalogCommitService().setState(playlist, key, 'completed')
    ).rejects.toMatchObject({ name: 'XtreamCatalogConnectionChangedError' });
});

it('classifies terminal failures without writing state or acknowledging recovery', async () => {
    check.mockResolvedValue({
        success: false,
        conditionChecked: true,
        connectionChanged: true,
    });
    await expect(
        new XtreamCatalogCommitService().assertCurrent(playlist)
    ).rejects.toMatchObject({ name: 'XtreamCatalogConnectionChangedError' });
    expect(check).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
});

it.each([
    { success: true },
    { success: false, conditionChecked: true },
    undefined,
])(
    'retains recovery if the bridge did not confirm conditional persistence: %j',
    async (result) => {
        write.mockResolvedValue(result);
        await expect(
            new XtreamCatalogCommitService().setState(
                playlist,
                key,
                'completed'
            )
        ).rejects.toThrow('Could not commit');
    }
);
