# Session Context

## User Prompts

### Prompt 1

can you check why i get that error: electron.service.ts:270 Portal status check failed - portal may be unavailable: Error invoking remote method 'XTREAM_REQUEST': [object Object]
root_effect_scheduler.mjs:3637 ERROR TypeError: Cannot read properties of null (reading 'filter')
    at displayedChannels.ngDevMode.debugName [as computation] (channel-list-container.component.ts:102:29)
    at Object.producerRecomputeValue (signal.mjs:468:33)
    at producerUpdateValueVersion (signal.mjs:158:10)
    a...

### Prompt 2

@apps/web/src/app/home/video-player/ @libs/ui/components/src/lib/art-player/ i got feedback for the app "Hello,
I am using the latest IPTVnator version (v0.19.0 Windows x64) and I noticed that there is no option to switch audio tracks during playback.
Many IPTV streams contain multiple audio tracks (for example ENG / RUS / LT), and players based on hls.js or Video.js usually support switching between them. IPTVnator also uses these engines as described in the documentation. [iptvtalk.net]
Howeve...

### Prompt 3

can not see the button in videojs player, where should it be, can you maybe add logs to see if audio tracks are available for live tv channel

### Prompt 4

here are the logs: [AudioTrack] addtrack event fired, total tracks: 1
vjs-player.component.ts:146 [AudioTrack] Audio tracks count: 1
vjs-player.component.ts:149 [AudioTrack] Track 0: label="default", language="", enabled=true, kind="main"
video.es.js:220 VIDEOJS: ERROR: TypeError: this.player.tech_ is not a function
    at _VjsPlayerComponent.logAudioTracks (vjs-player.component.ts:155:34)
    at AudioTrackList.<anonymous> (vjs-player.component.ts:78:30)
    at data.dispatcher (video.es.js:2268:...

