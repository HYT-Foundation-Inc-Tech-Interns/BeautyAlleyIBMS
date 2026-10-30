import fs from "fs";
import path from "path";

/**
 * One test run at a time, enforced with a pid-stamped lock file.
 *
 * ## Why
 *
 * Every suite talks to the *same* hosted database, and `globalSetup` seeds it,
 * which TRUNCATEs seventeen tables. That makes a second concurrent run not
 * merely slow but actively destructive to the first: the second seed wipes rows
 * the first is midway through asserting against, and the two runs then book the
 * same computed slots, so one of them collects 409 SLOT_TAKEN for a booking it
 * never collided with.
 *
 * The symptom is indistinguishable from flakiness - "24 failed across three
 * suites, 414 passed on a re-run, no code change in between" - which is exactly
 * how it was first diagnosed. Two runs of `bookings.test.ts` started together
 * reproduce it in seconds: the losing process dies in `globalSetup` with
 * `duplicate key value violates unique constraint "services_pkey"`, because
 * both seeds truncated and re-inserted the same rows.
 *
 * A silent collision costs a debugging session; a refused start costs a
 * sentence. So this fails fast and says which pid is already running.
 *
 * ## Why a file and not a Postgres advisory lock
 *
 * A session-level advisory lock would be the natural fit, but it has to be held
 * by a connection that outlives `globalSetup`. Jest loads `globalSetup` and
 * `globalTeardown` as separate module registries, so a module-level client in
 * one is not reachable from the other - the connection would close and the lock
 * would vanish before the suites even started.
 */

/** Where the lock lives: `backend/.jest-run.lock`, next to the package.json. */
export const LOCK_PATH = path.join(__dirname, "..", "..", ".jest-run.lock");

interface LockRecord {
  pid: number;
  startedAt: string;
}

export interface AcquireOptions {
  /** Overridable so the unit test does not fight a real run for the real path. */
  lockPath?: string;
  /** Overridable so the unit test does not depend on which pids this machine has. */
  isAlive?: (pid: number) => boolean;
}

/**
 * True when a process with this pid exists.
 *
 * `process.kill(pid, 0)` sends no signal, it only asks the OS whether the pid is
 * addressable. `EPERM` means it exists but belongs to another user - still a
 * live run as far as this guard is concerned.
 */
export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(lockPath: string): LockRecord | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof parsed.pid !== "number") return null;
    return { pid: parsed.pid, startedAt: String(parsed.startedAt ?? "") };
  } catch {
    // Missing or half-written: both are treated as "no lock", and the stale
    // branch below overwrites them.
    return null;
  }
}

/**
 * Take the run lock, or throw if another live run holds it.
 *
 * A lock left behind by a run that crashed or was killed is reclaimed: the pid
 * in it is no longer alive, so refusing would make the suite permanently
 * unrunnable until someone deleted a file by hand.
 */
export function acquireRunLock(options: AcquireOptions = {}): void {
  const lockPath = options.lockPath ?? LOCK_PATH;
  const isAlive = options.isAlive ?? pidIsAlive;

  const existing = readLock(lockPath);
  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
    throw new Error(
      `Another test run is already in progress (pid ${existing.pid}, started ${existing.startedAt || "unknown"}).\n\n` +
        "Both runs share one database, and globalSetup TRUNCATEs it - so running two at once\n" +
        "makes each one fail tests the other is responsible for. Wait for the first run to\n" +
        `finish, or stop it, then delete ${lockPath} if it never exited.`
    );
  }

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

/**
 * Release the lock, but only if this process owns it.
 *
 * A run that failed in `globalSetup` still reaches `globalTeardown`, and a lock
 * reclaimed from a dead run must not be deleted by the process that lost the
 * race. Ownership is the pid written into the file.
 */
export function releaseRunLock(options: AcquireOptions = {}): void {
  const lockPath = options.lockPath ?? LOCK_PATH;
  const isAlive = options.isAlive ?? pidIsAlive;

  const existing = readLock(lockPath);
  if (!existing) return;
  if (existing.pid !== process.pid && isAlive(existing.pid)) return;

  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already gone - nothing to release.
  }
}
