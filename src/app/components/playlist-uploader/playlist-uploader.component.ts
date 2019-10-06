import { Component, EventEmitter } from '@angular/core';
import {
    UploadOutput,
    UploadInput,
    UploadFile,
    humanizeBytes,
    UploaderOptions
} from 'ngx-uploader';
import { ChannelStore, createChannel } from 'src/app/state';
import { M3uService } from 'src/app/services/m3u-service.service';
import { Router } from '@angular/router';

@Component({
    selector: 'app-playlist-uploader',
    templateUrl: './playlist-uploader.component.html',
    styleUrls: ['./playlist-uploader.component.css']
})
export class PlaylistUploaderComponent {
    url = 'http://localhost:4900/upload';
    formData: FormData;
    files: UploadFile[];
    uploadInput: EventEmitter<UploadInput>;
    humanizeBytes: Function;
    dragOver: boolean;
    options: UploaderOptions;

    constructor(
        private channelStore: ChannelStore,
        private m3uService: M3uService,
        private router: Router
    ) {
        this.options = {
            concurrency: 1,
            maxUploads: 1
        };
        this.files = [];
        this.uploadInput = new EventEmitter<UploadInput>();
        this.humanizeBytes = humanizeBytes;
    }

    onUploadOutput(output: UploadOutput): void {
        if (output.type === 'allAddedToQueue') {
            if (this.files.length > 0) {
                const fileReader = new FileReader();
                fileReader.onload = fileLoadedEvent => {
                    const result = (fileLoadedEvent.target as FileReader)
                        .result;
                    // console.log(result);
                    const array = (result as string).split('\n');
                    // console.log(array);
                    const playlist = this.m3uService.convertArrayToPlaylist(
                        array
                    );
                    playlist.segments.forEach(element => {
                        this.channelStore.add(createChannel(element));
                        this.navigateToPlayer();
                    });
                };
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
                file =>
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
            console.log(output.file.name + ' rejected');
        }
    }

    navigateToPlayer(): void {
        this.router.navigateByUrl('/iptv', { skipLocationChange: true });
    }
}
