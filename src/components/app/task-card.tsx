"use client";

/**
 * One task card, two jobs.
 *
 * The desk's task board and the floor's My Tasks show the same record with
 * different actions: the desk edits, reassigns and cancels; the stylist starts
 * and completes. The header, metadata and notes were duplicated in both pages,
 * and they had already drifted (different completion-note labels, different
 * instruction styling). This component owns that shared shell; each page passes
 * its own fields and actions.
 *
 * It deliberately does not fetch or mutate. The page owns the API call, so the
 * desk and the floor can use different endpoints (`/tasks/:id` vs
 * `/tasks/:id/status`) without this component knowing.
 */

import * as React from "react";
import type { Task, TaskPriority, TaskStatus } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/bits";

/* ------------------------------------------------------------------ *
 * Shared vocabulary
 * ------------------------------------------------------------------ */

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_TONE: Record<
  TaskPriority,
  "secondary" | "outline" | "warning" | "destructive"
> = {
  LOW: "secondary",
  MEDIUM: "outline",
  HIGH: "warning",
  URGENT: "destructive",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge variant={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export function TaskStatusBadge({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  if (overdue && status !== "COMPLETED" && status !== "CANCELLED") {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  const tone: Record<TaskStatus, "default" | "success" | "secondary" | "outline"> = {
    PENDING: "outline",
    IN_PROGRESS: "default",
    COMPLETED: "success",
    CANCELLED: "secondary",
  };
  return <Badge variant={tone[status]}>{STATUS_LABEL[status]}</Badge>;
}

/* ------------------------------------------------------------------ *
 * The shell
 * ------------------------------------------------------------------ */

export interface TaskField {
  label: string;
  value: string;
}

export function TaskCard({
  task,
  fields,
  headerActions,
  error,
  completionLabel = "Completion notes",
  instructionsVariant = "boxed",
  children,
  actions,
}: {
  task: Task;
  /** The page decides which facts matter: the desk shows the assignee, the floor shows completion. */
  fields: TaskField[];
  headerActions?: React.ReactNode;
  error?: string | null;
  completionLabel?: string;
  instructionsVariant?: "inline" | "boxed";
  /** The desk's edit form, when open. */
  children?: React.ReactNode;
  /** The floor's status buttons, or any footer. */
  actions?: React.ReactNode;
}) {
  return (
    <Panel className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
              {task.reference}
            </span>
            <TaskStatusBadge status={task.status} overdue={task.overdue} />
            <PriorityBadge priority={task.priority} />
          </div>
          <h3 className="mt-2 font-display text-[16.5px] font-semibold leading-snug">{task.title}</h3>
          {task.description && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground text-pretty">
              {task.description}
            </p>
          )}
        </div>

        {headerActions && <div className="flex shrink-0 gap-2">{headerActions}</div>}
      </div>

      <dl className="mt-3.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {f.label}
            </dt>
            <dd className="mt-0.5 truncate text-[13px]">{f.value}</dd>
          </div>
        ))}
      </dl>

      {task.instructions &&
        (instructionsVariant === "boxed" ? (
          <div className="mt-3.5 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-2.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Instructions
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed">{task.instructions}</p>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Instructions: </span>
            {task.instructions}
          </p>
        ))}

      {task.completionNotes && (
        <div className="mt-3 rounded-lg border border-success/25 bg-success/[0.06] px-3.5 py-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-success">
            {completionLabel}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed">{task.completionNotes}</p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2.5 text-[12.5px] text-destructive">
          {error}
        </p>
      )}

      {children}

      {actions && <div className="mt-4 flex flex-wrap items-center gap-2.5">{actions}</div>}
    </Panel>
  );
}
