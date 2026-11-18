import { useRef, useState, type PointerEvent } from "react";
import { swipeIntent, swipeStage, type SwipeStage } from "@/services/editor/swipe";

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  width: number;
  swiping: boolean;
}

/**
 * A line's swipe to the right (touch and pen; a mouse drag selects text as usual). The line
 * follows the finger; on release, the stage it reached is reported. A vertical movement is a
 * scroll and is left to the browser (the row has `touch-action: pan-y`). Elements marked
 * `data-no-swipe` (the drag handle) never start one.
 */
export function useSwipe({ enabled, onRelease }: { enabled: boolean; onRelease(stage: SwipeStage): void }) {
  const gesture = useRef<Gesture | null>(null);
  const [state, setState] = useState({ dx: 0, width: 0 });

  const end = () => {
    gesture.current = null;
    setState((s) => (s.dx === 0 ? s : { ...s, dx: 0 }));
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!enabled || e.pointerType === "mouse" || !e.isPrimary) return;
      if (e.target instanceof Element && e.target.closest("[data-no-swipe]")) return;
      gesture.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, width: e.currentTarget.getBoundingClientRect().width, swiping: false };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.x;
      if (!g.swiping) {
        const intent = swipeIntent(dx, e.clientY - g.y);
        if (intent === "scroll") {
          gesture.current = null;
          return;
        }
        if (intent === "undecided") return;
        g.swiping = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // not capturable (already released): the gesture still works while over the row
        }
      }
      e.preventDefault();
      setState({ dx: Math.max(0, dx), width: g.width });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const stage = g.swiping ? swipeStage(Math.max(0, e.clientX - g.x), g.width) : "none";
      end();
      if (stage !== "none") onRelease(stage);
    },
    onPointerCancel: end,
  };

  return { dx: state.dx, stage: swipeStage(state.dx, state.width), handlers };
}
