import { isSameDatabase, targetProblem } from "../env";

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

/**
 * The guard's decision, branch by branch.
 *
 * Each branch is a way the suite has been, or could be, pointed at real data.
 * The two that matter most are the ones a local checkout never exercises:
 * `TEST_DB_HOST` disagreement and a runner with no `.env.local` - both are CI.
 */
describe("targetProblem", () => {
  const APP = "postgresql://postgres.abc:secret@db.abc.supabase.co:5432/postgres";
  const TEST = "postgresql://postgres.test:secret@db.test.supabase.co:5432/postgres";

  it("allows a database that differs from the application's", () => {
    expect(targetProblem({ url: TEST, appUrl: APP })).toBeNull();
  });

  it("refuses the database the application uses", () => {
    expect(targetProblem({ url: APP, appUrl: APP })).toMatch(/Refusing to run/);
  });

  it("refuses a target that disagrees with TEST_DB_HOST", () => {
    // A swapped TEST_DATABASE_URL secret, on a runner with no .env.local to
    // compare against: the case the hostname check exists for.
    expect(
      targetProblem({ url: APP, appUrl: null, expectedHost: "db.test.supabase.co" })
    ).toMatch(/TEST_DB_HOST/);
  });

  it("allows a target TEST_DB_HOST names", () => {
    expect(
      targetProblem({ url: TEST, appUrl: null, expectedHost: "db.test.supabase.co" })
    ).toBeNull();
  });

  it("refuses when neither the application's url nor TEST_DB_HOST is known", () => {
    expect(targetProblem({ url: TEST, appUrl: null })).toMatch(/cannot prove/);
  });

  it("refuses when DATABASE_URL is missing", () => {
    expect(targetProblem({ url: undefined, appUrl: APP })).toMatch(/DATABASE_URL is not set/);
  });
});
