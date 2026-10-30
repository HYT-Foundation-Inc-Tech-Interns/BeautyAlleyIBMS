import fs from "fs";
import os from "os";
import path from "path";
import { acquireRunLock, releaseRunLock } from "../helpers/runLock";

/**
 * The guard that stops two test runs from corrupting each other.
 *
 * Worth a test because the failure it prevents is silent: without it, a
 * concurrent run does not error where the mistake is, it produces 409
 * SLOT_TAKEN and 404s three suites later, which reads as flaky code.
 *
 * Every case here drives an injected `isAlive`, so nothing depends on which
 * pids this machine happens to have - a real pid that exits between two
 * statements would make the suite flaky in exactly the way it is meant to
 * prevent.
 */

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "beauty-alley-lock-"));
  lockPath = path.join(dir, ".jest-run.lock");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeLock = (pid: number, startedAt = "2026-01-01T00:00:00.000Z") =>
  fs.writeFileSync(lockPath, JSON.stringify({ pid, startedAt }), "utf8");

const readLock = () => JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid: number };

describe("runLock", () => {
  it("writes a lock naming this process", () => {
    acquireRunLock({ lockPath });
    expect(readLock().pid).toBe(process.pid);
  });

  it("refuses to start while another live run holds it", () => {
    writeLock(4242);
    expect(() => acquireRunLock({ lockPath, isAlive: (pid) => pid === 4242 })).toThrow(
      /Another test run is already in progress \(pid 4242,/
    );
    // The refusal must not disturb the holder's lock.
    expect(readLock().pid).toBe(4242);
  });

  it("reclaims a lock left by a run that died", () => {
    writeLock(4242);
    expect(() => acquireRunLock({ lockPath, isAlive: () => false })).not.toThrow();
    expect(readLock().pid).toBe(process.pid);
  });

  it("reclaims a half-written lock instead of refusing forever", () => {
    fs.writeFileSync(lockPath, "", "utf8");
    expect(() => acquireRunLock({ lockPath })).not.toThrow();
    expect(readLock().pid).toBe(process.pid);
  });

  it("releases only its own lock", () => {
    writeLock(4242);
    releaseRunLock({ lockPath, isAlive: (pid) => pid === 4242 });
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("releases its own lock, and tolerates a missing one", () => {
    acquireRunLock({ lockPath });
    releaseRunLock({ lockPath });
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(() => releaseRunLock({ lockPath })).not.toThrow();
  });
});
