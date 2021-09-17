import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '../shared/shared.module';
import { HomeComponent } from './home.component';
import { FileUploadComponent } from './file-upload/file-upload.component';
import { UrlUploadComponent } from './url-upload/url-upload.component';
import { RecentPlaylistsComponent } from './recent-playlists/recent-playlists.component';
import { HomeRoutingModule } from './home.routing';
import { NgxUploaderModule } from 'ngx-uploader';
import { PlaylistInfoComponent } from './recent-playlists/playlist-info/playlist-info.component';
import { DragDropModule } from '@angular/cdk/drag-drop';

@NgModule({
    imports: [
        CommonModule,
        HomeRoutingModule,
        NgxUploaderModule,
        SharedModule,
        DragDropModule,
    ],
    declarations: [
        HomeComponent,
        FileUploadComponent,
        PlaylistInfoComponent,
        RecentPlaylistsComponent,
        UrlUploadComponent,
    ],
})
export class HomeModule {}
