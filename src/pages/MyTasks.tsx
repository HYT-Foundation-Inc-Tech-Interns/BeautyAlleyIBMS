"use client";

/**
 * My tasks — the floor's own worklist.
 *
 * The counterpart to `Tasks.tsx`. The desk *assigns*; this page is where the
 * work is *done*. Both read the same rows — there is no second copy of a task
 * anywhere — and the API decides who may see which: `/tasks/mine` is scoped to
 * the caller's employee row, so this page cannot show a colleague's work even
 * if it asked to.
 *
 * An employee may move a task's status and say what happened. They may not
 * rename it, reassign it or cancel it — those are the desk's, and the API
 * refuses them with a 403 whatever this page renders.
 */

import * as React from "react";
import {
  AlarmClock,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock3,
  PlayCircle,
  RefreshCw,
} from "lucide-react";

import { api } from "@/lib/api";
import type { Task, TaskPriority, TaskStatus } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { branchDay } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, StatTile } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading } from "@/components/app/api-bits";
import { PRIORITY_LABEL, STATUS_LABEL, TaskCard as TaskCardShell } from "@/components/app/task-card";

/* ------------------------------------------------------------------ *
 * Shared vocabulary
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * A task row
 * ------------------------------------------------------------------ */

function TaskCard({
  task,
  onChanged,
}: {
  task: Task;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState<TaskStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const terminal = task.status === "COMPLETED" || task.status === "CANCELLED";

  async function move(status: TaskStatus, completionNotes?: string) {
    setBusy(status);
    setError(null);
    try {
      await api.tasks.setStatus(task.id, status, completionNotes);
      setOpen(false);
      setNotes("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TaskCardShell
      task={task}
      completionLabel="What you reported"
      fields={[
        { label: "Assigned by", value: task.assignedBy },
        { label: "Date assigned", value: branchDay(task.assignedAt) },
        { label: "Due", value: task.dueAt ? branchDay(task.dueAt) : "No deadline" },
        { label: "Completed", value: task.completedAt ? branchDay(task.completedAt) : "—" },
      ]}
      error={error}
      actions={
        !terminal ? (
          <>
            {task.status === "PENDING" && (
              <Button
                variant="outline"
                className="gap-2"
                disabled={busy !== null}
                onClick={() => void move("IN_PROGRESS")}
              >
                <PlayCircle className="size-4" />
                {busy === "IN_PROGRESS" ? "Starting…" : "Start"}
              </Button>
            )}
            {!open ? (
              <Button className="gap-2" disabled={busy !== null} onClick={() => setOpen(true)}>
                <CheckCircle2 className="size-4" />
                Mark complete
              </Button>
            ) : (
              <div className="w-full">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    What did you do? (optional)
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Restocked the room and wiped the mirrors."
                    className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                  />
                </label>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    className="gap-2"
                    disabled={busy !== null}
                    onClick={() => void move("COMPLETED", notes.trim() || undefined)}
                  >
                    <CheckCircle2 className="size-4" />
                    {busy === "COMPLETED" ? "Saving…" : "Confirm complete"}
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function MyTasks() {
  const [status, setStatus] = React.useState<TaskStatus | "">("");
  const [priority, setPriority] = React.useState<TaskPriority | "">("");
  const [nonce, setNonce] = React.useState(0);

  const counts = useAsync(`mytasks:counts:${nonce}`, () => api.tasks.counts());

  const list = useAsync(`mytasks:list:${status}:${priority}:${nonce}`, () =>
    api.tasks.mine({
      limit: 100,
      sort: "created_at",
      order: "desc",
      status: status || undefined,
      priority: priority || undefined,
    }),
  );

  const refresh = () => setNonce((n) => n + 1);

  const all = list.data?.data ?? [];
  // The filter is applied server-side; this split is only about presentation —
  // finished work belongs in its own section, not mixed into the to-do pile.
  const open = all.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS");
  const done = all.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED");
  const showHistoryOnly = status === "COMPLETED" || status === "CANCELLED";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow="Work"
        icon={ClipboardList}
        title="My tasks"
        description="What the desk has asked you to do. Starting a task and completing it are yours to record; renaming it or handing it to someone else is not."
        actions={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pending"
          value={counts.data ? String(counts.data.pending) : "—"}
          hint="assigned, not started"
          icon={Clock3}
        />
        <StatTile
          label="In progress"
          value={counts.data ? String(counts.data.inProgress) : "—"}
          hint="you are on it"
          icon={CircleDot}
          tone="accent"
        />
        <StatTile
          label="Overdue"
          value={counts.data ? String(counts.data.overdue) : "—"}
          hint="past the due date"
          icon={AlarmClock}
          tone="danger"
        />
        <StatTile
          label="Completed"
          value={counts.data ? String(counts.data.completed) : "—"}
          hint="closed off your list"
          icon={CheckCircle2}
          tone="success"
        />
      </div>

      <Panel className="px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus | "")}
              className="mt-1.5 block h-10 min-w-[170px] rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            >
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Priority
            </span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
              className="mt-1.5 block h-10 min-w-[150px] rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Any priority</option>
              {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      {list.initial ? (
        <Loading label="Loading your tasks…" />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : all.length === 0 ? (
        <EmptyNote
          icon={ClipboardList}
          title="Nothing assigned"
          description={
            status || priority
              ? "No task matches these filters. Try clearing them."
              : "When the desk assigns you work it will appear here."
          }
        />
      ) : (
        <div className="space-y-6">
          {!showHistoryOnly && (
            <section className="space-y-3">
              <h2 className="eyebrow">Open · {open.length}</h2>
              {open.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-[13px] text-muted-foreground">
                  Nothing open. Every task assigned to you is finished.
                </p>
              ) : (
                open.map((t) => <TaskCard key={t.id} task={t} onChanged={refresh} />)
              )}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="eyebrow">History · {done.length}</h2>
            {done.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-[13px] text-muted-foreground">
                No completed work yet.
              </p>
            ) : (
              done.map((t) => <TaskCard key={t.id} task={t} onChanged={refresh} />)
            )}
          </section>
        </div>
      )}
    </div>
  );
}
