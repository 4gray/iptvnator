import { useEffect, useRef, useState } from 'preact/hooks';
/** Controls reappear on remote/pointer input; Back and media keys keep their normal meaning. */
export function usePlayerControls(fullscreen: boolean, paused: boolean) {
    const [visible, setVisible] = useState(true);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const current = useRef(visible);
    current.current = visible;
    const reveal = () => {
        setVisible(true);
        clearTimeout(timer.current);
        if (fullscreen && !paused)
            timer.current = setTimeout(() => setVisible(false), 5000);
    };
    useEffect(() => {
        reveal();
        return () => clearTimeout(timer.current);
    }, [fullscreen, paused]);
    useEffect(() => {
        if (!fullscreen) return;
        const key = (event: KeyboardEvent) => {
            if (!current.current && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
            }
            reveal();
        };
        document.addEventListener('keydown', key, true);
        document.addEventListener('mousemove', reveal);
        return () => {
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('mousemove', reveal);
        };
    }, [fullscreen, paused]);
    return visible;
}
