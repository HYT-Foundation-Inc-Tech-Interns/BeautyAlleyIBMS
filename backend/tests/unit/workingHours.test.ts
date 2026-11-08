import { setWorkingHoursSchema } from "../../src/modules/employees/employees.schemas";

/**
 * The rota payload, as the route validates it.
 *
 * Overlap detection is not here: it lives in the repository, where it can see
 * the whole week in one place, and the SQL function re-checks the ordering.
 * What this file pins down is the shape the editor must produce - 24-hour
 * `HH:MM`, weekday 0-6, and a window that actually has a length.
 */
const week = (weekday: number, startTime: string, endTime: string) => ({
  weekday,
  startTime,
  endTime,
});

describe("working hours schema", () => {
  it("accepts the house pattern, Monday to Saturday", () => {
    const hours = [1, 2, 3, 4, 5, 6].map((weekday) => week(weekday, "09:00", "18:00"));
    expect(setWorkingHoursSchema.safeParse({ hours }).success).toBe(true);
  });

  it("accepts a split shift on one day", () => {
    const hours = [week(1, "09:00", "13:00"), week(1, "15:00", "19:00")];
    expect(setWorkingHoursSchema.safeParse({ hours }).success).toBe(true);
  });

  it("accepts an empty week, because the engine reads no windows as unbookable", () => {
    expect(setWorkingHoursSchema.safeParse({ hours: [] }).success).toBe(true);
  });

  it("refuses a window that ends before it starts", () => {
    expect(setWorkingHoursSchema.safeParse({ hours: [week(2, "18:00", "09:00")] }).success).toBe(
      false,
    );
  });

  it("refuses a zero-length window", () => {
    expect(setWorkingHoursSchema.safeParse({ hours: [week(2, "09:00", "09:00")] }).success).toBe(
      false,
    );
  });

  it("refuses a weekday outside 0-6", () => {
    expect(setWorkingHoursSchema.safeParse({ hours: [week(7, "09:00", "18:00")] }).success).toBe(
      false,
    );
    expect(setWorkingHoursSchema.safeParse({ hours: [week(-1, "09:00", "18:00")] }).success).toBe(
      false,
    );
  });

  it("refuses a time that is not 24-hour HH:MM", () => {
    expect(setWorkingHoursSchema.safeParse({ hours: [week(1, "9:00", "18:00")] }).success).toBe(
      false,
    );
    expect(setWorkingHoursSchema.safeParse({ hours: [week(1, "09:00", "6pm")] }).success).toBe(
      false,
    );
  });

  it("refuses more than twenty-one windows", () => {
    const hours = Array.from({ length: 22 }, () => week(1, "09:00", "18:00"));
    expect(setWorkingHoursSchema.safeParse({ hours }).success).toBe(false);
  });
});
