import { testCheckoutSchema } from "../../src/modules/deposits/deposits.service";

describe("deposit test checkout schema", () => {
  it("accepts a normal deposit", () => {
    expect(testCheckoutSchema.safeParse({ amountCents: 50000 }).success).toBe(true);
  });

  it("refuses an amount below one peso", () => {
    expect(testCheckoutSchema.safeParse({ amountCents: 99 }).success).toBe(false);
  });

  it("refuses an amount above ten thousand pesos", () => {
    expect(testCheckoutSchema.safeParse({ amountCents: 1_000_001 }).success).toBe(false);
  });

  it("refuses a fractional cent", () => {
    expect(testCheckoutSchema.safeParse({ amountCents: 500.5 }).success).toBe(false);
  });
});
