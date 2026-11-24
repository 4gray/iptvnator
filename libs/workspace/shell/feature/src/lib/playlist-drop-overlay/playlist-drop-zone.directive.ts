import {
    DestroyRef,
    Directive,
    ElementRef,
    HostListener,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotificationService } from '@iptvnator/services/notifications';
import { PlaylistFileImportService } from '@iptvnator/playlist/shared/util';
import { fromEvent, merge } from 'rxjs';
import type { PlaylistDropOverlayState } from './playlist-drop-overlay.component';

const REJECTED_DISMISS_MS = 1800;

@Directive({
    selector: '[appPlaylistDropZone]',
    exportAs: 'playlistDropZone',
})
export class PlaylistDropZoneDirective implements OnInit {
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private readonly importService = inject(PlaylistFileImportService);
    private readonly notifications = inject(NotificationService);

    private dragDepth = 0;
    private rejectionTimer: ReturnType<typeof setTimeout> | null = null;

    readonly overlayState = signal<PlaylistDropOverlayState>({ kind: 'idle' });

    ngOnInit(): void {
        merge(
            fromEvent<KeyboardEvent>(window, 'keydown'),
            fromEvent(window, 'blur')
        )
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((event) => {
                if (event instanceof KeyboardEvent && event.key !== 'Escape') {
                    return;
                }
                this.resetState();
            });
    }

    @HostListener('dragenter', ['$event'])
    onDragEnter(event: DragEvent): void {
        if (!this.isFileDrag(event)) return;
        event.preventDefault();
        this.dragDepth += 1;
        if (this.overlayState().kind === 'rejected') return;
        this.overlayState.set({ kind: 'dragging' });
    }

    @HostListener('dragover', ['$event'])
    onDragOver(event: DragEvent): void {
        if (!this.isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    @HostListener('dragleave', ['$event'])
    onDragLeave(event: DragEvent): void {
        if (!this.isFileDrag(event)) return;
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (this.dragDepth === 0 && this.overlayState().kind === 'dragging') {
            this.overlayState.set({ kind: 'idle' });
        }
    }

    @HostListener('drop', ['$event'])
    async onDrop(event: DragEvent): Promise<void> {
        if (!this.isFileDrag(event)) return;
        event.preventDefault();
        this.dragDepth = 0;

        const file = event.dataTransfer?.files?.[0];
        if (!file) {
            this.overlayState.set({ kind: 'idle' });
            return;
        }

        const result = await this.importService.importFile(file);
        if (result.ok === true) {
            this.overlayState.set({ kind: 'idle' });
            this.notifications.success('WORKSPACE.SHELL.DROP_IMPORT_SUCCESS', {
                title: result.title,
            });
            return;
        }

        this.flashRejection(result.reason);
    }

    private isFileDrag(event: DragEvent): boolean {
        const types = event.dataTransfer?.types;
        if (!types) return false;
        return Array.from(types).includes('Files');
    }

    private flashRejection(
        reason: 'unsupported' | 'empty' | 'read-error'
    ): void {
        this.overlayState.set({ kind: 'rejected', reason });
        this.clearRejectionTimer();
        this.rejectionTimer = setTimeout(() => {
            this.overlayState.set({ kind: 'idle' });
            this.rejectionTimer = null;
        }, REJECTED_DISMISS_MS);
    }

    private resetState(): void {
        this.dragDepth = 0;
        this.clearRejectionTimer();
        this.overlayState.set({ kind: 'idle' });
    }

    private clearRejectionTimer(): void {
        if (this.rejectionTimer !== null) {
            clearTimeout(this.rejectionTimer);
            this.rejectionTimer = null;
        }
    }
}
