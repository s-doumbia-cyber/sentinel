import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useRef, useState } from "react";
import { INCIDENT_STATUSES } from "@sentinel/shared";
import { NeutralBadge, SeverityBadge } from "@/components/ui/Badges";
import { cn } from "@/lib/format";
import type { Incident, IncidentStatus } from "@/lib/types";

const isStatus = (v: unknown): v is IncidentStatus => (INCIDENT_STATUSES as readonly unknown[]).includes(v);

/** Which column a keyboard drag is currently over. Keyboard drags are decided by this, not by geometry. */
type KeyboardTarget = { current: IncidentStatus | null };

/**
 * A mouse or touch drag is dropped where the pointer is. A keyboard drag has no pointer, and going by where its
 * rectangle sits proved unreliable (a mouse left resting over the board, found by the e2e run, made it pick the
 * wrong column), so it is dropped on the column the arrow keys last chose.
 */
const detectCollision =
  (keyboard: boolean, target: KeyboardTarget): CollisionDetection =>
  (args) => {
    if (keyboard) {
      const column = args.droppableContainers.find((c) => c.id === target.current);
      return column ? [{ id: column.id }] : [];
    }
    const within = pointerWithin(args);
    return within.length ? within : rectIntersection(args);
  };

/**
 * Arrow keys hop to the previous or next status, in board order, and centre the card in that column. Plain pixel
 * steps (the default) would take dozens of presses to cross a column. The chosen column is recorded in `target`,
 * which is what the drop uses; the returned coordinates only move the card on screen.
 */
export const columnKeyboardCoordinates =
  (target: KeyboardTarget): KeyboardCoordinateGetter =>
  (event, { context: { active, droppableRects, collisionRect } }) => {
    const dir = event.code === "ArrowRight" || event.code === "ArrowDown" ? 1 : event.code === "ArrowLeft" || event.code === "ArrowUp" ? -1 : 0;
    if (!active || !collisionRect || !dir) return undefined;
    event.preventDefault();
    const next = INCIDENT_STATUSES[INCIDENT_STATUSES.indexOf(target.current ?? "Open") + dir];
    const rect = next ? droppableRects.get(next) : undefined;
    if (!next || !rect) return undefined;
    target.current = next;
    return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + 48 };
  };

function CardFace({ incident, onOpen }: { incident: Incident; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(incident.id)} className="min-w-0 flex-1 rounded-sm p-1 text-left">
      <span className="flex flex-wrap gap-1">
        <NeutralBadge>{incident.priority}</NeutralBadge>
        <SeverityBadge severity={incident.severity} />
      </span>
      <span className="mt-2 line-clamp-2 block text-small font-medium text-fg-1">{incident.title}</span>
      <span className="mt-1 block text-caption text-fg-3">{incident.assignee?.name ?? "Unassigned"}</span>
    </button>
  );
}

function Card({ incident, onOpen, canMove }: { incident: Incident; onOpen: (id: string) => void; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: incident.id, disabled: !canMove });
  return (
    <div
      ref={setNodeRef}
      {...(canMove ? listeners : {})}
      className={cn("flex items-start gap-1 rounded-md border bg-surface-1 p-2 shadow-e1 hover:border-strong", isDragging && "opacity-40")}
    >
      {canMove && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          aria-label={`Move incident ${incident.title}. Currently ${incident.status}.`}
          className="mt-0.5 shrink-0 cursor-grab rounded-sm p-1 text-fg-3 hover:bg-surface-3 hover:text-fg-1 active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="h-4 w-4" />
        </button>
      )}
      <CardFace incident={incident} onOpen={onOpen} />
    </div>
  );
}

function Column({ status, items, onOpen, canMove }: { status: IncidentStatus; items: Incident[]; onOpen: (id: string) => void; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${status} (${items.length})`}
      className={cn("flex min-w-0 flex-col rounded-lg border bg-bg-0 p-2 transition-colors duration-fast", isOver ? "border-accent bg-accent-soft" : "border-subtle")}
    >
      <h2 className="flex items-center justify-between px-2 py-1.5 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">
        {status} <span className="tnum">{items.length}</span>
      </h2>
      <ul className="min-h-[96px] flex-1 space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <Card incident={i} onOpen={onOpen} canMove={canMove} />
          </li>
        ))}
        {items.length === 0 && <li className="rounded-md border border-dashed px-3 py-6 text-center text-caption text-fg-3">{canMove ? "Drop an incident here" : "No incidents"}</li>}
      </ul>
    </section>
  );
}

export interface IncidentBoardProps {
  items: Incident[];
  /** Viewers see the board but cannot move cards; the API enforces the same. */
  canMove: boolean;
  onOpen: (id: string) => void;
  onMove: (incident: Incident, to: IncidentStatus) => void;
}

/**
 * Kanban board on dnd-kit (not Framer Motion, which swallows native drag events: lesson 2). Move a card with
 * the mouse or a long press, or with the keyboard: focus its grip, Space to pick up, arrow keys to change
 * column, Space to drop, Esc to cancel. The page decides what a move does (optimistic update, rollback).
 */
export function IncidentBoard({ items, canMove, onOpen, onMove }: IncidentBoardProps) {
  const [active, setActive] = useState<Incident | null>(null);
  const keyboardDrag = useRef(false);
  const keyboardTarget = useRef<IncidentStatus | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates(keyboardTarget) }),
  );
  const byId = (id: unknown) => items.find((i) => i.id === id) ?? null;
  const titleOf = (id: unknown) => byId(id)?.title ?? "incident";

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${titleOf(a.id)}. It is in ${byId(a.id)?.status ?? "its column"}. Use the arrow keys to choose a column, Space to drop, Escape to cancel.`,
    onDragOver: ({ active: a, over }) => (over ? `${titleOf(a.id)} is over ${String(over.id)}.` : `${titleOf(a.id)} is not over a column.`),
    onDragEnd: ({ active: a, over }) => (over && isStatus(over.id) && byId(a.id)?.status !== over.id ? `${titleOf(a.id)} dropped in ${over.id}.` : `${titleOf(a.id)} dropped where it was.`),
    onDragCancel: ({ active: a }) => `Move cancelled. ${titleOf(a.id)} did not move.`,
  };

  const onDragStart = (e: DragStartEvent) => {
    keyboardDrag.current = e.activatorEvent instanceof KeyboardEvent;
    const incident = byId(e.active.id);
    keyboardTarget.current = incident?.status ?? null;
    setActive(incident);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const incident = byId(e.active.id);
    if (incident && e.over && isStatus(e.over.id) && e.over.id !== incident.status) onMove(incident, e.over.id);
  };
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => detectCollision(keyboardDrag.current, keyboardTarget)(args)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "To pick up an incident, press Space. Use the arrow keys to move it between columns, Space to drop it, Escape to cancel." } }}
    >
      {!canMove && <p className="mb-3 text-small text-fg-3">Moving incidents needs the Analyst role. You can open any incident.</p>}
      <div role="region" aria-label="Incident board" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {INCIDENT_STATUSES.map((status) => (
          <Column key={status} status={status} items={items.filter((i) => i.status === status)} onOpen={onOpen} canMove={canMove} />
        ))}
      </div>
      <DragOverlay dropAnimation={reduced ? null : undefined}>{active ? (
          <div className="flex cursor-grabbing items-start gap-1 rounded-md border border-strong bg-surface-1 p-2 shadow-e3">
            <GripVertical aria-hidden className="m-1 h-4 w-4 shrink-0 text-fg-3" />
            <CardFace incident={active} onOpen={onOpen} />
          </div>
        ) : null}</DragOverlay>
    </DndContext>
  );
}
