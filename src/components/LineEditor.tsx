import { useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAuth } from "@/hooks/useAuth";
import { usePageClock } from "@/hooks/usePageClock";
import { subscribe } from "@/lib/events";
import { restrictToVerticalAxis } from "@/lib/dndModifiers";
import { GHOST_LINE } from "@/services/editor/pageLines";
import { usePageStore, visiblePageLines } from "@/stores/pageStore";
import { LineRow, type LineHandlers } from "./LineRow";
import { LinePanel } from "./LinePanel";
import { UndoToast } from "./UndoToast";

/** The page: every line, in order, as a plain-text editor (docs/05-line-mapping.md §3). */
export function LineEditor() {
  const { t } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const flags = usePageStore((s) => s.flags);
  const filter = usePageStore((s) => s.filter);
  const focus = usePageStore((s) => s.focus);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;

  useEffect(() => {
    void store().load(ownerSub);
  }, [store, ownerSub]);

  // Reload from IndexedDB after a sync that changed rows, or a write in another tab.
  useEffect(
    () =>
      subscribe((event, fromOtherTab) => {
        if ((event.type === "synced" && event.changed) || (event.type === "localWrite" && fromOtherTab)) void store().refresh();
      }),
    [store],
  );

  // Save pending text when the tab is hidden or closed (CLAUDE.md, rule 8).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void store().flushAll();
    };
    const onPageHide = () => void store().flushAll();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [store]);

  // The page's clock: lines hidden until later come back when their time arrives.
  const now = usePageClock(activities);

  // The page as shown: with a flag filter, only the matching lines (FlagFilter).
  const lines = useMemo(() => visiblePageLines(activities, flags, filter, now), [activities, flags, filter, now]);
  const filtered = filter.length > 0;
  const shown = lines.length > 0 ? lines : [GHOST_LINE];

  const handlers: LineHandlers = useMemo(
    () => ({
      onType: (id, raw) => store().type(id, raw),
      onCommit: (id) => void store().commit(id),
      onEnter: (id, s, e) => void store().enter(id, s, e),
      onBackspaceAtStart: (id) => store().backspaceAtStart(id),
      onDeleteAtEnd: (id) => store().deleteAtEnd(id),
      onPaste: (id, s, e, text) => void store().paste(id, s, e, text),
      onMove: (id, delta) => {
        const caret = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement.selectionStart : 0;
        void store()
          .move(id, delta)
          .then(() => {
            // Put the focus back only if the move lost it (nothing focused); a key pressed
            // meanwhile (↓ to the next line, Ctrl+. into the panel) already moved it on, and
            // must win.
            const active = document.activeElement;
            if (!active || active === document.body) store().setFocus(id, caret);
          });
      },
      onFocusNeighbour: (id, direction, caret) => {
        const s = store();
        const current = visiblePageLines(s.activities, s.flags, s.filter);
        const index = current.findIndex((l) => l.id === id);
        const target = current[index + direction];
        if (target) store().setFocus(target.id, caret);
      },
      onTick: (id) => void store().tick(id),
      onOpenPanel: (id) => store().openPanel(id),
    }),
    [store],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const s = store();
      const to = visiblePageLines(s.activities, s.flags, s.filter).findIndex((l) => l.id === over.id);
      if (to >= 0) void store().moveTo(String(active.id), to);
    },
    [store],
  );

  const position = (id: string | number) => lines.findIndex((l) => l.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("page.dnd.pickedUp", { n: position(active.id) }),
    onDragOver: ({ over }) => (over ? t("page.dnd.movedOver", { n: position(over.id) }) : undefined),
    onDragEnd: ({ over }) => (over ? t("page.dnd.dropped", { n: position(over.id) }) : t("page.dnd.cancelled")),
    onDragCancel: () => t("page.dnd.cancelled"),
  };

  if (status === "error") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        {t("page.loadError")}
      </p>
    );
  }
  if (status !== "ready") return null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("page.dnd.instructions") } }}
      >
        <SortableContext items={shown.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="sm:-ms-6">
            {shown.map((line, index) => (
              <LineRow
                key={line.id}
                line={line}
                row={activities[line.id]}
                index={index}
                flags={flags}
                focus={focus}
                draggable={lines.length > 1}
                placeholder={lines.length === 0 ? t(filtered ? "filter.emptyPlaceholder" : "page.placeholder") : undefined}
                {...handlers}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {lines.length > 0 && (
        <button
          type="button"
          data-testid="line-add"
          className="mt-1 flex items-center gap-2 rounded px-1 py-1 text-sm text-neutral-400 outline-none hover:bg-neutral-50 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
          // flushSync: the new line is rendered and focused within the tap, so phones open the keyboard.
          onClick={() => flushSync(() => void store().addLineAtEnd())}
        >
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center text-base leading-none">
            +
          </span>
          {t("page.addLine")}
        </button>
      )}
      <LinePanel />
      <UndoToast />
    </>
  );
}
