import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BehaviorSubject } from 'rxjs';

export interface MpvProcess {
    id: number;
    url: string;
    start_time: number;
    last_known_time: number | null;
    thumbnail?: string;
    title: string;
}

@Injectable({
    providedIn: 'root',
})
export class MpvPlayerService {
    private activeProcessesSubject = new BehaviorSubject<MpvProcess[]>([]);
    public activeProcesses$ = this.activeProcessesSubject.asObservable();

    constructor() {
        this.initializeEventListeners();
        this.loadActiveProcesses();
    }

    private async initializeEventListeners() {
        // Listen for new processes
        await listen('mpv-process-added', (event: any) => {
            const newProcess = event.payload as MpvProcess;
            if (newProcess) {
                const currentProcesses = this.activeProcessesSubject.value;
                this.activeProcessesSubject.next([
                    ...currentProcesses,
                    newProcess,
                ]);
            }
        });

        // Listen for removed processes
        await listen('mpv-process-removed', (event: any) => {
            const removedProcess = event.payload as MpvProcess;
            if (removedProcess) {
                const currentProcesses = this.activeProcessesSubject.value;
                this.activeProcessesSubject.next(
                    currentProcesses.filter((p) => p.id !== removedProcess.id)
                );
            }
        });
    }

    private async loadActiveProcesses() {
        try {
            const processes = await invoke<MpvProcess[]>(
                'get_active_mpv_processes'
            );
            this.activeProcessesSubject.next(processes);
        } catch (error) {
            console.error('Failed to load active MPV processes:', error);
        }
    }

    async openStream(
        url: string,
        title: string,
        thumbnail?: string,
        mpvPath: string = ''
    ): Promise<number> {
        return await invoke<number>('open_in_mpv', {
            url,
            path: mpvPath,
            title,
            thumbnail,
        });
    }

    async playStream(processId: number): Promise<void> {
        await invoke('mpv_play', { processId });
    }

    async pauseStream(processId: number): Promise<void> {
        await invoke('mpv_pause', { processId });
    }

    async closeStream(processId: number): Promise<void> {
        await invoke('close_mpv_process', { processId });
    }
}
