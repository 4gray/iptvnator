/**
 * Frame pump for the frame-copy embedded MPV engine.
 *
 * Runs inside the preload script (isolated world, full Node access — the
 * frame-copy experiment disables the window sandbox, see
 * getMainWindowWebPreferences). It loads the shm frame-reader addon, copies
 * the newest BGRA frame into a reused ArrayBuffer once per rAF, and uploads
 * it into a WebGL2 texture on the renderer's `<canvas
 * data-embedded-mpv-frame>` element. No frame data ever crosses the
 * contextBridge — the bridge only exposes attach/detach lifecycle calls.
 */
import { ipcRenderer } from 'electron';
import {
    EMBEDDED_MPV_FRAME_SOURCE_CHANGED,
    EMBEDDED_MPV_GET_FRAME_SOURCE,
    EmbeddedMpvFrameSource,
} from '@iptvnator/shared/interfaces';

interface FrameReaderInfo {
    width: number;
    height: number;
    stride: number;
    frameBytes: number;
    generation: number;
}

interface FrameReaderAddon {
    open(shmName: string): FrameReaderInfo;
    latestSeq(): number;
    copyLatest(
        buffer: ArrayBuffer
    ): { seq: number; ageMs: number; torn: boolean } | null;
    producerAliveMs(): number;
    close(): void;
}

/* Webpack rewrites bare `require`; the addon must go through the runtime
 * require so the .node file is loaded by Node itself. */
declare const __non_webpack_require__: NodeRequire | undefined;
const nodeRequire: NodeRequire =
    typeof __non_webpack_require__ === 'function'
        ? __non_webpack_require__
        : require;

const CANVAS_SELECTOR = 'canvas[data-embedded-mpv-frame]';
const ATTACH_TIMEOUT_MS = 5000;
const ATTACH_POLL_MS = 100;

const VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    v_uv = vec2(corner.x, 1.0 - corner.y);
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o_color;
void main() {
    vec4 c = texture(u_tex, v_uv);
    o_color = vec4(c.b, c.g, c.r, 1.0);
}`;

interface PumpState {
    sessionId: string;
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    texture: WebGLTexture;
    reader: FrameReaderAddon;
    frame: Uint8Array;
    width: number;
    height: number;
    lastSeq: number;
    rafHandle: number;
}

let pump: PumpState | null = null;
let sourceListenerRegistered = false;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCanvas(): Promise<HTMLCanvasElement | null> {
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const canvas = document.querySelector<HTMLCanvasElement>(
            CANVAS_SELECTOR
        );
        if (canvas) return canvas;
        await delay(ATTACH_POLL_MS);
    }
    return null;
}

async function waitForFrameSource(
    sessionId: string
): Promise<EmbeddedMpvFrameSource | null> {
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const source = (await ipcRenderer.invoke(
            EMBEDDED_MPV_GET_FRAME_SOURCE,
            sessionId
        )) as EmbeddedMpvFrameSource | null;
        if (source?.shmName) return source;
        await delay(ATTACH_POLL_MS);
    }
    return null;
}

function createGl(
    canvas: HTMLCanvasElement
): { gl: WebGL2RenderingContext; texture: WebGLTexture } | null {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const program = gl.createProgram();
    for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX_SHADER],
        [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
    ] as const) {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(
                '[embedded-mpv-pump] shader error:',
                gl.getShaderInfoLog(shader)
            );
            return null;
        }
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { gl, texture: texture as WebGLTexture };
}

function applySource(state: PumpState, source: EmbeddedMpvFrameSource): boolean {
    try {
        const info = state.reader.open(source.shmName);
        state.width = info.width;
        state.height = info.height;
        state.frame = new Uint8Array(info.frameBytes);
        state.lastSeq = 0;
        state.canvas.width = info.width;
        state.canvas.height = info.height;
        state.gl.viewport(0, 0, info.width, info.height);
        state.gl.texImage2D(
            state.gl.TEXTURE_2D,
            0,
            state.gl.RGBA,
            info.width,
            info.height,
            0,
            state.gl.RGBA,
            state.gl.UNSIGNED_BYTE,
            null
        );
        return true;
    } catch (error) {
        console.error('[embedded-mpv-pump] failed to open frame ring:', error);
        return false;
    }
}

function pumpTick(): void {
    if (!pump) return;
    pump.rafHandle = requestAnimationFrame(pumpTick);

    const { gl, reader, frame } = pump;
    if (reader.latestSeq() > pump.lastSeq) {
        const result = reader.copyLatest(frame.buffer as ArrayBuffer);
        if (result) {
            gl.texSubImage2D(
                gl.TEXTURE_2D,
                0,
                0,
                0,
                pump.width,
                pump.height,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                frame
            );
            pump.lastSeq = result.seq;
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
    }
}

function ensureSourceListener(): void {
    if (sourceListenerRegistered) return;
    sourceListenerRegistered = true;
    ipcRenderer.on(
        EMBEDDED_MPV_FRAME_SOURCE_CHANGED,
        (_event, payload: { sessionId: string; source: EmbeddedMpvFrameSource }) => {
            if (!pump || payload.sessionId !== pump.sessionId) return;
            applySource(pump, payload.source);
        }
    );
}

export async function attachEmbeddedMpvFrameView(
    sessionId: string
): Promise<boolean> {
    detachEmbeddedMpvFrameView();
    ensureSourceListener();

    const canvas = await waitForCanvas();
    if (!canvas) {
        console.error('[embedded-mpv-pump] frame canvas not found in DOM');
        return false;
    }
    const source = await waitForFrameSource(sessionId);
    if (!source) {
        console.error('[embedded-mpv-pump] no frame source for', sessionId);
        return false;
    }

    let reader: FrameReaderAddon;
    try {
        reader = nodeRequire(source.readerPath) as FrameReaderAddon;
    } catch (error) {
        console.error('[embedded-mpv-pump] failed to load reader:', error);
        return false;
    }

    const glSetup = createGl(canvas);
    if (!glSetup) {
        console.error('[embedded-mpv-pump] WebGL2 unavailable');
        return false;
    }

    const state: PumpState = {
        sessionId,
        canvas,
        gl: glSetup.gl,
        texture: glSetup.texture,
        reader,
        frame: new Uint8Array(0),
        width: 0,
        height: 0,
        lastSeq: 0,
        rafHandle: 0,
    };
    if (!applySource(state, source)) {
        reader.close();
        return false;
    }

    pump = state;
    pump.rafHandle = requestAnimationFrame(pumpTick);
    return true;
}

export function detachEmbeddedMpvFrameView(): void {
    if (!pump) return;
    cancelAnimationFrame(pump.rafHandle);
    try {
        pump.reader.close();
    } catch {
        // reader may already be gone with the helper; nothing to release
    }
    pump = null;
}
