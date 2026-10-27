import { branchDay, branchDayStart, nextBranchDay } from "../../src/lib/dates";

/**
 * The branch day boundary.
 *
 * `branchDay()` was already the one definition of "which day is this", and the
 * list filters ignored it: they compared `start_time` against
 * `${day}T00:00:00Z`, which is UTC's midnight. In Manila that is 08:00, so
 * every appointment before it belonged to the previous UTC day and vanished
 * from "today" — the 07:00 chair was missing from the day it was on.
 */
describe("branch day boundaries", () => {
  it("starts a Manila day eight hours before UTC midnight", () => {
    expect(branchDayStart("2026-10-27").toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  it("round-trips: the boundary belongs to the day it names", () => {
    const start = branchDayStart("2026-10-27");
    expect(branchDay(start)).toBe("2026-10-27");
    expect(branchDay(new Date(start.getTime() - 1))).toBe("2026-10-26");
  });

  it("holds at the year boundary", () => {
    expect(nextBranchDay("2026-12-31")).toBe("2027-01-01");
    expect(branchDayStart("2027-01-01").toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });
});
