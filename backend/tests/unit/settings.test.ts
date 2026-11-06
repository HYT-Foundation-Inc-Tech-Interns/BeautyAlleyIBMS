import {
  updateBookingRulesSchema,
  updatePaymentProvidersSchema,
} from "../../src/modules/settings/settings.schemas";
import { changePasswordSchema, adminResetPasswordSchema } from "../../src/modules/auth/auth.schemas";

/**
 * The rules that stop a settings form from saving something the rest of the
 * system cannot read. The UI mirrors them, but the API is the boundary.
 */
describe("payment providers schema", () => {
  const all = [
    { id: "cash", enabled: true },
    { id: "gcash", enabled: true },
    { id: "maya", enabled: false },
    { id: "card", enabled: false },
    { id: "bank_transfer", enabled: false },
  ] as const;

  it("accepts a default that is enabled", () => {
    const result = updatePaymentProvidersSchema.safeParse({ default: "cash", options: all });
    expect(result.success).toBe(true);
  });

  it("refuses a default that is switched off", () => {
    const result = updatePaymentProvidersSchema.safeParse({ default: "maya", options: all });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["default"]);
    }
  });

  it("refuses the same provider twice", () => {
    const result = updatePaymentProvidersSchema.safeParse({
      default: "cash",
      options: [
        { id: "cash", enabled: true },
        { id: "cash", enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a provider the system does not know", () => {
    const result = updatePaymentProvidersSchema.safeParse({
      default: "cash",
      options: [{ id: "g-cash", enabled: true }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an empty list", () => {
    const result = updatePaymentProvidersSchema.safeParse({ default: "cash", options: [] });
    expect(result.success).toBe(false);
  });
});

describe("booking rules schema", () => {
  it("accepts the current production policy", () => {
    const result = updateBookingRulesSchema.safeParse({
      cancellationWindowHours: 2,
      arrivalWindowMinutes: 60,
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero, which means no notice and a pass that opens on time", () => {
    const result = updateBookingRulesSchema.safeParse({
      cancellationWindowHours: 0,
      arrivalWindowMinutes: 0,
    });
    expect(result.success).toBe(true);
  });

  it("refuses a negative cutoff", () => {
    const result = updateBookingRulesSchema.safeParse({
      cancellationWindowHours: -1,
      arrivalWindowMinutes: 60,
    });
    expect(result.success).toBe(false);
  });

  it("refuses an arrival window beyond four hours", () => {
    const result = updateBookingRulesSchema.safeParse({
      cancellationWindowHours: 2,
      arrivalWindowMinutes: 241,
    });
    expect(result.success).toBe(false);
  });

  it("refuses a fractional hour", () => {
    const result = updateBookingRulesSchema.safeParse({
      cancellationWindowHours: 2.5,
      arrivalWindowMinutes: 60,
    });
    expect(result.success).toBe(false);
  });
});

describe("password schemas", () => {
  it("requires the current password when changing your own", () => {
    const result = changePasswordSchema.safeParse({ currentPassword: "", newPassword: "a-long-password" });
    expect(result.success).toBe(false);
  });

  it("refuses a new password identical to the current one", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "a-long-password",
      newPassword: "a-long-password",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a short password", () => {
    const result = changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "short" });
    expect(result.success).toBe(false);
  });

  it("lower-cases and trims the email for an admin reset", () => {
    const result = adminResetPasswordSchema.safeParse({
      email: "  Stylist@BeautyAlley.PH ",
      newPassword: "a-long-password",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("stylist@beautyalley.ph");
  });
});
