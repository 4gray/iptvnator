import { Component, EventEmitter, NgZone } from '@angular/core';
import {
    UploadOutput,
    UploadInput,
    UploadFile,
    humanizeBytes,
    UploaderOptions,
} from 'ngx-uploader';
import { ChannelStore, createChannel } from '../state';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Playlist } from './playlist.interface';

@Component({
    selector: 'app-playlist-uploader',
    templateUrl: './playlist-uploader.component.html',
    styleUrls: ['./playlist-uploader.component.scss'],
})
export class PlaylistUploaderComponent {
    renderer = window.require('electron').ipcRenderer;
    playlistUrl = '';

    formData: FormData;
    files: UploadFile[] = [];
    uploadInput: EventEmitter<UploadInput> = new EventEmitter<UploadInput>();
    humanizeBytes: any = humanizeBytes;
    dragOver: boolean;
    options: UploaderOptions = {
        allowedContentTypes: [
            'application/x-mpegurl',
            'application/octet-stream',
            'application/mpegurl',
            'application/vnd.apple.mpegurl',
            'application/vnd.apple.mpegurl.audio',
            'audio/x-mpegurl',
            'audio/mpegurl',
        ],
        concurrency: 1,
        maxUploads: 1,
    };
    playlists: { count: number; title: string; _id: string }[] = [];
    isLoading = false;

    /**
     * Creates an instanceof PlaylistUploaderComponent
     * @param channelStore channels store
     * @param router angulars router
     * @param snackBar snackbars with notification messages
     */
    constructor(
        private channelStore: ChannelStore,
        private ngZone: NgZone,
        private router: Router,
        private snackBar: MatSnackBar
    ) {
        // get all playlists
        this.renderer.send('playlists-all');
        // set all renderer listeners
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.renderer.on('parse-response', (event, response) => {
            this.ngZone.run(() => this.setPlaylist(response.payload));
        });

        this.renderer.on('parse-url-response', (event, response) => {
            this.ngZone.run(() => this.setPlaylist(response.payload));
        });

        this.renderer.on('playlist-all-result', (event, response) => {
            this.ngZone.run(() => (this.playlists = response.payload));
        });
        this.renderer.on('playlist-by-id-result', (event, response) => {
            this.ngZone.run(() => this.setPlaylist(response.payload));
        });
        this.renderer.on('playlist-remove-by-id-result', () => {
            this.ngZone.run(() => {
                this.snackBar.open('Done! Playlist was removed.', null, {
                    duration: 2000,
                });
                this.renderer.send('playlists-all');
            });
        });
    }

    /**
     * Handles file upload
     * @param output
     */
    onUploadOutput(output: UploadOutput): void {
        if (output.type === 'allAddedToQueue') {
            if (this.files.length > 0) {
                this.isLoading = true;
                const fileReader = new FileReader();
                fileReader.onload = (fileLoadedEvent) =>
                    this.handlePlaylist(fileLoadedEvent);
                fileReader.readAsText(this.files[0].nativeFile);
            }
        } else if (
            output.type === 'addedToQueue' &&
            typeof output.file !== 'undefined'
        ) {
            this.files.push(output.file);
        } else if (
            output.type === 'uploading' &&
            typeof output.file !== 'undefined'
        ) {
            const index = this.files.findIndex(
                (file) =>
                    typeof output.file !== 'undefined' &&
                    file.id === output.file.id
            );
            this.files[index] = output.file;
        } else if (output.type === 'cancelled' || output.type === 'removed') {
            this.files = this.files.filter(
                (file: UploadFile) => file !== output.file
            );
        } else if (output.type === 'dragOver') {
            this.dragOver = true;
        } else if (output.type === 'dragOut') {
            this.dragOver = false;
        } else if (output.type === 'drop') {
            this.dragOver = false;
        } else if (
            output.type === 'rejected' &&
            typeof output.file !== 'undefined'
        ) {
            this.snackBar.open(
                `File was rejected, unsupported file format (${output.file.name}).`,
                null,
                {
                    duration: 2000,
                }
            );
            this.isLoading = false;
        }
    }

    /**
     * Parse and store uploaded playlist
     * @param fileLoadedEvent
     */
    handlePlaylist(fileLoadedEvent: Event): void {
        const result = (fileLoadedEvent.target as FileReader).result;
        const array = (result as string).split('\n');
        this.renderer.send('parse-playlist', {
            title: this.files[0].name,
            playlist: array,
        });
    }

    /**
     * Navigates to the video player route
     */
    navigateToPlayer(): void {
        this.isLoading = false;
        this.router.navigateByUrl('/iptv', { skipLocationChange: true });
    }

    /**
     * Sends url of the playlist to the renderer process
     */
    sendPlaylistsUrl(): void {
        this.renderer.send('parse-playlist-by-url', {
            title: this.getLastUrlSegment(this.playlistUrl),
            url: this.playlistUrl,
        });
    }

    /**
     * Sets the given playlist as active for the current session
     * @param playlist playlist object
     */
    setPlaylist(playlist: Playlist): void {
        this.channelStore.reset();
        const favorites = playlist.favorites || [];
        const channels = playlist.playlist.items.map((element) =>
            createChannel(element, favorites)
        );
        this.channelStore.upsertMany(channels);
        this.channelStore.update(() => ({
            favorites,
            playlistId: playlist.id,
        }));
        this.navigateToPlayer();
    }

    /**
     * Removes the provided playlist from the database
     * @param playlistId playlist id to remove
     */
    removePlaylist(playlistId: string): void {
        this.renderer.send('playlist-remove-by-id', { id: playlistId });
    }

    /**
     * Requests playlist by id
     * @param playlistId playlist id
     */
    getPlaylist(playlistId: string): void {
        this.renderer.send('playlist-by-id', { id: playlistId });
    }

    /**
     * Returns last segment (part after last slash "/") of the given URL
     * @param value URL as string
     */
    getLastUrlSegment(value: string): string {
        if (value && value.length > 1) {
            return value.substr(value.lastIndexOf('/') + 1);
        } else {
            return '';
        }
    }
}
