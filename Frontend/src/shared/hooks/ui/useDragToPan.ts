import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Click-and-drag panning for a zoomed, scrollable preview (e.g. an image at >100%
 * zoom inside an `overflow-auto` container). Dragging moves the content the same
 * way scrolling does — it manipulates the container's native scrollLeft/scrollTop
 * rather than a separate transform, so it composes with wheel-scroll and
 * scrollbars instead of fighting them.
 *
 * Usage: spread `onMouseDown` onto the scrollable container and attach
 * `containerRef` to it; `enabled` gates whether dragging does anything (e.g. only
 * once zoomed in past 100%).
 */
export function useDragToPan<T extends HTMLElement>(enabled: boolean) {
  const containerRef = useRef<T>(null);
  const dragState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || !containerRef.current) return;
      e.preventDefault();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop,
      };
      setIsDragging(true);
    },
    [enabled],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const state = dragState.current;
      const el = containerRef.current;
      if (!state || !el) return;
      el.scrollLeft = state.scrollLeft - (e.clientX - state.startX);
      el.scrollTop = state.scrollTop - (e.clientY - state.startY);
    };
    const handleUp = () => {
      setIsDragging(false);
      dragState.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  return { containerRef, onMouseDown, isDragging };
}
