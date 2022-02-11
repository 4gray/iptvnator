import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { NgxUploaderModule } from 'ngx-uploader';
import { SharedModule } from '../shared/shared.module';
import { FileUploadComponent } from './file-upload/file-upload.component';
import { HomeComponent } from './home.component';
import { HomeRoutingModule } from './home.routing';
import { PlaylistInfoComponent } from './recent-playlists/playlist-info/playlist-info.component';
import { UrlUploadComponent } from './url-upload/url-upload.component';

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
        UrlUploadComponent,
    ],
})
export class HomeModule {}
