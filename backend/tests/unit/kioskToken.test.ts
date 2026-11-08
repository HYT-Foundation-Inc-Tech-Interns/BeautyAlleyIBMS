import {
  createDeviceSecret,
  deviceSecretMatches,
  formatKioskToken,
  hashDeviceSecret,
  parseKioskToken,
} from "../../src/lib/kioskToken";

/**
 * The device token is the only thing standing between a guessed string and a
 * screen that can look up arrivals at the door, so these tests are adversarial
 * rather than happy-path: they tamper, truncate, mis-prefix and replay.
 *
 * The one property worth stating out loud is that the id is *not* a secret.
 * It travels in the clear, so a test that only checked the id would pass for a
 * token with any secret at all - which is why every rejection case below keeps
 * a valid id and breaks something else.
 */

const ID = "9f1d3a2e-4b6c-4d8e-9f0a-1b2c3d4e5f60";

describe("kiosk device secret", () => {
  it("mints a 43-character base64url secret and a 64-character hex digest", () => {
    const { secret, hash } = createDeviceSecret();

    expect(secret).toHaveLength(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never issues the same secret twice", () => {
    const seen = new Set(Array.from({ length: 200 }, () => createDeviceSecret().secret));
    expect(seen.size).toBe(200);
  });

  it("hashes with sha256, so the digest is reproducible", () => {
    // Known vector: sha256("abc"). If this changes, every stored device stops
    // authenticating, so it is worth pinning rather than trusting the import.
    expect(hashDeviceSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("does not put the secret in the digest", () => {
    const { secret, hash } = createDeviceSecret();
    expect(hash).not.toContain(secret);
    expect(hashDeviceSecret(secret)).toBe(hash);
  });
});

describe("formatting and parsing", () => {
  it("round-trips id and secret through the token", () => {
    const { secret } = createDeviceSecret();
    const parsed = parseKioskToken(formatKioskToken(ID, secret));

    expect(parsed).toEqual({ id: ID, secret });
  });

  it("produces exactly three dot-separated parts, prefixed `kiosk`", () => {
    const { secret } = createDeviceSecret();
    const parts = formatKioskToken(ID, secret).split(".");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("kiosk");
    expect(parts[1]).toBe(ID);
  });

  it.each([
    ["empty", ""],
    ["no separators", "kioskabcdef"],
    ["two parts", `kiosk.${ID}`],
    ["four parts", `kiosk.${ID}.secret.extra`],
    ["wrong prefix", `qr.${ID}.${"a".repeat(43)}`],
    ["empty prefix", `.${ID}.${"a".repeat(43)}`],
    ["prefix in the wrong case", `KIOSK.${ID}.${"a".repeat(43)}`],
    ["a non-uuid id", `kiosk.not-a-uuid.${"a".repeat(43)}`],
    ["a truncated id", `kiosk.9f1d3a2e.${"a".repeat(43)}`],
    ["a secret that is too short", `kiosk.${ID}.${"a".repeat(42)}`],
    ["a secret that is too long", `kiosk.${ID}.${"a".repeat(44)}`],
    ["an empty secret", `kiosk.${ID}.`],
  ])("rejects %s", (_name, raw) => {
    expect(parseKioskToken(raw)).toBeNull();
  });

  it("does not accept a booking pass, which shares the dot format", () => {
    const body = Buffer.from(JSON.stringify({ jti: ID, bid: ID, exp: 1 })).toString("base64url");
    expect(parseKioskToken(`BA1.${body}.${"a".repeat(43)}`)).toBeNull();
  });
});

describe("secret comparison", () => {
  it("accepts the secret the digest was made from", () => {
    const { secret, hash } = createDeviceSecret();
    expect(deviceSecretMatches(secret, hash)).toBe(true);
  });

  it("rejects a different secret of the same length", () => {
    const { hash } = createDeviceSecret();
    const other = createDeviceSecret().secret;
    expect(deviceSecretMatches(other, hash)).toBe(false);
  });

  it("rejects an empty secret rather than throwing", () => {
    const { hash } = createDeviceSecret();
    expect(deviceSecretMatches("", hash)).toBe(false);
  });

  it("rejects a stored digest that is empty, malformed or the wrong length", () => {
    const { secret } = createDeviceSecret();

    // `Buffer.from("", "hex")` is a zero-length buffer and `timingSafeEqual`
    // throws on a length mismatch, so each of these is a 500 waiting to happen
    // if the guard is ever removed.
    expect(deviceSecretMatches(secret, "")).toBe(false);
    expect(deviceSecretMatches(secret, "not-a-hash")).toBe(false);
    expect(deviceSecretMatches(secret, "abcd")).toBe(false);
  });

  it("rejects the digest itself presented as the secret", () => {
    const { hash } = createDeviceSecret();
    expect(deviceSecretMatches(hash, hash)).toBe(false);
  });
});
