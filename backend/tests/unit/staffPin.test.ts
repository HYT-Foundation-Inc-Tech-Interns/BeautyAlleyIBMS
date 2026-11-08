import { PIN_PATTERN } from "../../src/lib/staffPin";

/**
 * The PIN is stored as a blind index, so there are exactly two properties to
 * pin down: the same PIN under the same pepper must produce the same digest
 * (or nobody can ever be admitted), and a different pepper must produce a
 * different one (or the pepper is doing nothing).
 *
 * The unset-pepper case is the one that matters most in practice. A silent
 * fallback to an unkeyed HMAC would look identical from the outside until
 * someone dumped the table and read every PIN out of it in a second, so the
 * function must refuse rather than proceed.
 */

/** Load `lib/staffPin` against a chosen pepper. `env` is read at call time, not import time. */
function withPepper(pepper: string): typeof import("../../src/lib/staffPin") {
  jest.resetModules();
  jest.doMock("../../src/config/env", () => ({ env: { kioskPinPepper: pepper } }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/lib/staffPin");
}

afterEach(() => {
  jest.dontMock("../../src/config/env");
  jest.resetModules();
});

describe("pinLookup", () => {
  it("is stable for the same PIN and pepper", () => {
    const { pinLookup } = withPepper("a".repeat(32));
    expect(pinLookup("4821")).toBe(pinLookup("4821"));
  });

  it("is a 64-character hex digest", () => {
    const { pinLookup } = withPepper("a".repeat(32));
    expect(pinLookup("4821")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not contain the PIN", () => {
    const { pinLookup } = withPepper("a".repeat(32));
    expect(pinLookup("4821")).not.toContain("4821");
  });

  it("separates 4821 from 48210, so a shorter PIN is not a prefix match", () => {
    const { pinLookup } = withPepper("a".repeat(32));
    expect(pinLookup("4821")).not.toBe(pinLookup("48210"));
  });

  it("changes when the pepper changes", () => {
    const first = withPepper("a".repeat(32)).pinLookup("4821");
    const second = withPepper("b".repeat(32)).pinLookup("4821");
    expect(first).not.toBe(second);
  });

  it("refuses to hash at all when the pepper is unset", () => {
    const { pinLookup } = withPepper("");

    let caught: { status?: number; code?: string } | null = null;
    try {
      pinLookup("4821");
    } catch (err) {
      caught = err as { status?: number; code?: string };
    }

    // 503 rather than 500: the request is fine, the deployment is not.
    expect(caught?.status).toBe(503);
    expect(caught?.code).toBe("CONFIG_ERROR");
  });

  it("reports whether the pepper is present", () => {
    expect(withPepper("a".repeat(32)).hasPinPepper()).toBe(true);
    expect(withPepper("").hasPinPepper()).toBe(false);
  });
});

describe("PIN_PATTERN", () => {
  it.each(["0000", "1234", "9999", "123456", "000000"])("accepts %s", (pin) => {
    expect(PIN_PATTERN.test(pin)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["three digits", "123"],
    ["seven digits", "1234567"],
    ["letters", "12a4"],
    ["a space", "12 4"],
    ["a sign", "+123"],
    ["a decimal", "12.4"],
    ["a newline", "1234\n"],
  ])("rejects %s", (_name, pin) => {
    expect(PIN_PATTERN.test(pin)).toBe(false);
  });
});
