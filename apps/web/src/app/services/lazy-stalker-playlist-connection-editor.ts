import { EnvironmentInjector, inject, Injectable } from '@angular/core';
import type {
    StalkerPlaylistConnectionEditor,
    StalkerPlaylistConnectionResult,
    StalkerResolvedConnectionApplyOptions,
} from '@iptvnator/playlist/shared/ui/stalker-connection-editor';
import type {
    PlaylistMeta,
    PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';

type EditorModule =
    typeof import('./stalker-playlist-connection-editor.service');

/**
 * Registered as STALKER_PLAYLIST_CONNECTION_EDITOR in app.config. The real
 * editor depends on the whole Stalker portal data layer, which would
 * otherwise be evaluated before the first paint although it is only needed
 * when a user edits or re-checks a Stalker source. Every editor method is
 * asynchronous, so the implementation is imported on first use and resolved
 * from the root injector (it is providedIn: 'root').
 */
@Injectable({ providedIn: 'root' })
export class LazyStalkerPlaylistConnectionEditor implements StalkerPlaylistConnectionEditor {
    private readonly injector = inject(EnvironmentInjector);
    private editor: Promise<StalkerPlaylistConnectionEditor> | null = null;

    /** The dynamic import; a field so specs can substitute it. */
    loadEditorModule: () => Promise<EditorModule> = () =>
        import('./stalker-playlist-connection-editor.service');

    async resolveConnection(
        playlist: PlaylistMeta,
        sourcePlaylist?: PlaylistMeta
    ): Promise<StalkerPlaylistConnectionResult> {
        const editor = await this.resolveEditor();
        return editor.resolveConnection(playlist, sourcePlaylist);
    }

    async applyResolvedConnection(
        playlist: PlaylistMetaUpdate,
        options?: StalkerResolvedConnectionApplyOptions
    ): Promise<PlaylistMetaUpdate> {
        const editor = await this.resolveEditor();
        return editor.applyResolvedConnection(playlist, options);
    }

    private resolveEditor(): Promise<StalkerPlaylistConnectionEditor> {
        this.editor ??= this.loadEditorModule().then((module) =>
            this.injector.get(module.AppStalkerPlaylistConnectionEditorService)
        );
        // A failed chunk load must not poison later attempts.
        this.editor.catch(() => (this.editor = null));
        return this.editor;
    }
}
