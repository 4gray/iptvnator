import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PlaylistUploaderComponent } from './components/playlist-uploader/playlist-uploader.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';

const routes: Routes = [
    {
        path: '',
        component: PlaylistUploaderComponent
    },
    {
        path: 'iptv',
        component: VideoPlayerComponent
    }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule {}
