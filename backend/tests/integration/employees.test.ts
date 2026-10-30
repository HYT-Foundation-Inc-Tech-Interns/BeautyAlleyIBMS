import request from "supertest";
import { randomUUID } from "crypto";
import {
  api,
  as,
  createTestAdmin,
  deleteTestUsers,
  type TestUser,
} from "../helpers/api";
import { connectDb, db, disconnectDb } from "../helpers/db";

/**
 * A stylist created through the console has to be *usable* immediately.
 *
 * "Issue a team login" is the only way the console creates a roster row, and it
 * used to write the employee with an empty qualification set - so the person
 * appeared on the roster saying "cannot be booked for anything yet" and was
 * absent from every service-filtered list and from the booking grid, which is
 * indistinguishable from the creation having failed.
 *
 * These tests assert the three conditions the booking engine actually consults
 * (see get_available_slots): is_active, an employee_services row for the
 * service, and a working_hours row for that weekday.
 */
const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeStaff = hasServiceRole ? describe : describe.skip;

describeStaff("employee creation", () => {
  const created: TestUser[] = [];
  const employeeIds: string[] = [];

  const SVC_COMBINATION = "11111111-0000-0000-0000-000000000021";
  const SVC_THERAPEUTIC = "11111111-0000-0000-0000-000000000023";

  // A Monday far enough out that no suite books it. Availability is read-only
  // here - this file creates no bookings - so it needs no slot band.
  const MONDAY = "2031-01-06";

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    if (employeeIds.length > 0) {
      await db().query("delete from public.employees where id = any($1::uuid[])", [employeeIds]);
    }
    await deleteTestUsers(created);
    await disconnectDb();
  });

  let seq = 0;
  const staffEmail = () => `staff.${Date.now()}.${++seq}@beautyalley.ph`;

  /** POST /admin/users/staff, recording both the account and the roster row. */
  async function createStaff(
    admin: TestUser,
    body: Record<string, unknown> = {},
  ): Promise<{ status: number; body: any }> {
    const res = await request(api())
      .post("/api/v1/admin/users/staff")
      .set(...as(admin.token))
      .send({
        email: staffEmail(),
        password: "StaffPass123!",
        fullName: "Nadia Qualified",
        role: "EMPLOYEE",
        ...body,
      });
    if (res.body?.data?.id) created.push({ id: res.body.data.id } as TestUser);
    if (res.body?.data?.employeeId) employeeIds.push(res.body.data.employeeId);
    return res;
  }

  const publicIds = async (query: string): Promise<string[]> => {
    const res = await request(api()).get(`/api/v1/employees?${query}&limit=100`);
    expect(res.status).toBe(200);
    return res.body.data.map((e: { id: string }) => e.id);
  };

  it("creates the roster row qualified for the services named at creation", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, { serviceIds: [SVC_COMBINATION] });
    expect(res.status).toBe(201);
    const employeeId = res.body.data.employeeId;
    expect(employeeId).toBeTruthy();

    // The qualification is real data, not just an echo of the request.
    const detail = await request(api()).get(`/api/v1/employees/${employeeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.serviceIds).toEqual([SVC_COMBINATION]);

    // And the service filter finds them.
    expect(await publicIds(`serviceId=${SVC_COMBINATION}`)).toContain(employeeId);
  });

  it("does not offer them for a service they are not qualified for", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, { serviceIds: [SVC_COMBINATION] });
    const employeeId = res.body.data.employeeId;

    expect(await publicIds(`serviceId=${SVC_THERAPEUTIC}`)).not.toContain(employeeId);
  });

  it("offers them in the booking grid on a day they work", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, { serviceIds: [SVC_COMBINATION] });
    const employeeId = res.body.data.employeeId;

    const slots = await request(api()).get(
      `/api/v1/availability?serviceId=${SVC_COMBINATION}&date=${MONDAY}&intervalMinutes=60`,
    );
    expect(slots.status).toBe(200);
    const ids = slots.body.data.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).toContain(employeeId);
  });

  it("puts an unqualified stylist on the roster but not in the booking grid", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, { fullName: "Unqualified Una" });
    expect(res.status).toBe(201);
    const employeeId = res.body.data.employeeId;

    const roster = await request(api())
      .get("/api/v1/admin/employees?includeInactive=true&limit=100")
      .set(...as(admin.token));
    expect(roster.status).toBe(200);
    expect(roster.body.data.map((e: { id: string }) => e.id)).toContain(employeeId);

    const slots = await request(api()).get(
      `/api/v1/availability?serviceId=${SVC_COMBINATION}&date=${MONDAY}&intervalMinutes=60`,
    );
    const ids = slots.body.data.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).not.toContain(employeeId);
  });

  it("drops a deactivated stylist from the public list and the booking grid", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, { serviceIds: [SVC_COMBINATION] });
    const employeeId = res.body.data.employeeId;

    const patched = await request(api())
      .patch(`/api/v1/employees/${employeeId}`)
      .set(...as(admin.token))
      .send({ isActive: false });
    expect(patched.status).toBe(200);

    expect(await publicIds(`serviceId=${SVC_COMBINATION}`)).not.toContain(employeeId);

    const slots = await request(api()).get(
      `/api/v1/availability?serviceId=${SVC_COMBINATION}&date=${MONDAY}&intervalMinutes=60`,
    );
    const ids = slots.body.data.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).not.toContain(employeeId);
  });

  it("refuses an unknown service id and leaves no roster row behind", async () => {
    const admin = await createTestAdmin();
    created.push(admin);

    const res = await createStaff(admin, {
      fullName: "Ghost Stylist",
      serviceIds: [randomUUID()],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICES_INVALID");

    const roster = await request(api())
      .get("/api/v1/admin/employees?includeInactive=true&limit=100")
      .set(...as(admin.token));
    const names = roster.body.data.map((e: { fullName: string }) => e.fullName);
    expect(names).not.toContain("Ghost Stylist");
  });
});
