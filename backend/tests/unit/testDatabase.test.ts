import { isSameDatabase } from "../env";

/**
 * The comparison behind the "do not seed the application's database" guard.
 *
 * Worth a test of its own because the guard is only as good as this function:
 * a false negative here truncates the branch's real data, and the failure is
 * silent - the run looks green, the bookings are simply gone.
 */
describe("isSameDatabase", () => {
  const APP = "postgresql://postgres.abc:secret@db.abc.supabase.co:5432/postgres";

  it("recognises the same database despite different credentials", () => {
    expect(
      isSameDatabase(APP, "postgresql://other:different@db.abc.supabase.co:5432/postgres")
    ).toBe(true);
  });

  it("ignores the query string a pooler url carries", () => {
    expect(
      isSameDatabase(APP, "postgresql://postgres.abc:secret@db.abc.supabase.co:5432/postgres?sslmode=require")
    ).toBe(true);
  });

  it("separates two different projects", () => {
    expect(
      isSameDatabase(APP, "postgresql://postgres:secret@db.testsupabase.supabase.co:5432/postgres")
    ).toBe(false);
  });

  it("separates two databases on the same host", () => {
    expect(isSameDatabase(APP, "postgresql://postgres:secret@db.abc.supabase.co:5432/beauty_test")).toBe(
      false
    );
  });

  it("treats an unparseable url as the same database, so the run is refused", () => {
    expect(isSameDatabase(APP, "not-a-url")).toBe(true);
  });
});
