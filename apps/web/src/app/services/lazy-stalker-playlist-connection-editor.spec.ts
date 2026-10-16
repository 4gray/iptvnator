import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
    StalkerPlaylistConnectionEditor,
    StalkerPlaylistConnectionResult,
} from '@iptvnator/playlist/shared/ui/stalker-connection-editor';
import type {
    PlaylistMeta,
    PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';
import { LazyStalkerPlaylistConnectionEditor } from './lazy-stalker-playlist-connection-editor';

const resolved: StalkerPlaylistConnectionResult = {
    status: 'resolved',
    playlist: { _id: 'p1' } as PlaylistMetaUpdate,
};

@Injectable({ providedIn: 'root' })
class FakeEditor implements StalkerPlaylistConnectionEditor {
    resolveConnection = jest.fn(async () => resolved);
    applyResolvedConnection = jest.fn(
        async (playlist: PlaylistMetaUpdate) => playlist
    );
}

type EditorModule = Awaited<
    ReturnType<LazyStalkerPlaylistConnectionEditor['loadEditorModule']>
>;

function moduleWith(editorClass: typeof FakeEditor): EditorModule {
    return {
        AppStalkerPlaylistConnectionEditorService: editorClass,
    } as unknown as EditorModule;
}

describe('LazyStalkerPlaylistConnectionEditor', () => {
    let lazy: LazyStalkerPlaylistConnectionEditor;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        lazy = TestBed.inject(LazyStalkerPlaylistConnectionEditor);
    });

    it('loads nothing until an editor method is called', () => {
        const load = jest.fn(async () => moduleWith(FakeEditor));
        lazy.loadEditorModule = load;

        expect(load).not.toHaveBeenCalled();
    });

    it('delegates both methods to the root-provided implementation, loading it once', async () => {
        const load = jest.fn(async () => moduleWith(FakeEditor));
        lazy.loadEditorModule = load;
        const playlist = { _id: 'p1' } as PlaylistMeta;
        const source = { _id: 'p0' } as PlaylistMeta;
        const update = { _id: 'p1', title: 'Renamed' } as PlaylistMetaUpdate;

        await expect(lazy.resolveConnection(playlist, source)).resolves.toBe(
            resolved
        );
        await expect(
            lazy.applyResolvedConnection(update, {
                preserveCurrentMetadata: true,
            })
        ).resolves.toBe(update);

        const editor = TestBed.inject(FakeEditor);
        expect(editor.resolveConnection).toHaveBeenCalledWith(playlist, source);
        expect(editor.applyResolvedConnection).toHaveBeenCalledWith(update, {
            preserveCurrentMetadata: true,
        });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('retries the import after a failed chunk load', async () => {
        const load = jest
            .fn<Promise<EditorModule>, []>()
            .mockRejectedValueOnce(new Error('chunk failed'))
            .mockResolvedValueOnce(moduleWith(FakeEditor));
        lazy.loadEditorModule = load;
        const playlist = { _id: 'p1' } as PlaylistMeta;

        await expect(lazy.resolveConnection(playlist)).rejects.toThrow(
            'chunk failed'
        );
        await expect(lazy.resolveConnection(playlist)).resolves.toBe(resolved);
        expect(load).toHaveBeenCalledTimes(2);
    });
});
