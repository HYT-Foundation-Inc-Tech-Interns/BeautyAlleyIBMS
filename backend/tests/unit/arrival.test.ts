import {
  admissionBlocker,
  arrivalState,
  normalisePass,
  verifyArrivalPass,
  type ArrivalFacts,
} from "../../src/lib/arrival";
import { signQrPass, type QrPayload } from "../../src/lib/qr";

/**
 * The door's two questions, tested without a database: "is this a pass we
 * issued?" and "where does this arrival sit in its window?".
 *
 * The priority order in `admissionBlocker` is the part worth testing hardest.
 * It is not a list of independent checks - the same pass can be several kinds
 * of wrong at once, and which sentence the guest reads decides whether they
 * wait, pay, or leave.
 */

const UUID = "9f1d3a2e-4b6c-4d8e-9f0a-1b2c3d4e5f60";

const payload: QrPayload = {
  jti: UUID,
  bid: "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("normalisePass", () => {
  it("leaves a raw token alone", () => {
    const pass = signQrPass(payload);
    expect(normalisePass(pass)).toBe(pass);
  });

  it("trims surrounding whitespace", () => {
    const pass = signQrPass(payload);
    expect(normalisePass(`  ${pass}\n`)).toBe(pass);
  });

  it("pulls the token out of the URL the QR encodes", () => {
    const pass = signQrPass(payload);
    expect(normalisePass(`https://beautyalley.app/check-in?pass=${pass}`)).toBe(pass);
  });

  it("leaves a URL with no pass parameter intact, so the verifier rejects it", () => {
    const url = "https://beautyalley.app/check-in?other=1";
    expect(normalisePass(url)).toBe(url);
  });

  it("does not invent a token from a URL path", () => {
    const url = "https://beautyalley.app/check-in/BA1.abc.def";
    expect(normalisePass(url)).toBe(url);
  });
});

describe("verifyArrivalPass", () => {
  it("returns the payload of a pass we signed", () => {
    expect(verifyArrivalPass(signQrPass(payload))).toEqual(payload);
  });

  it("accepts a pass wrapped in a URL", () => {
    const url = `https://beautyalley.app/check-in?pass=${signQrPass(payload)}`;
    expect(verifyArrivalPass(url)).toEqual(payload);
  });

  it("reports an expired pass as expired, not invalid", () => {
    const expired = { ...payload, exp: Math.floor(Date.now() / 1000) - 60 };
    expect(() => verifyArrivalPass(signQrPass(expired))).toThrow(
      expect.objectContaining({ code: "QR_EXPIRED", status: 400 })
    );
  });

  it("reports junk as invalid", () => {
    expect(() => verifyArrivalPass("not-a-pass")).toThrow(
      expect.objectContaining({ code: "QR_INVALID", status: 400 })
    );
  });

  it("reports a forged signature as invalid, not as expired", () => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const forged = `BA1.${body}.${Buffer.from("not-the-real-hmac").toString("base64url")}`;
    expect(() => verifyArrivalPass(forged)).toThrow(
      expect.objectContaining({ code: "QR_INVALID" })
    );
  });
});

describe("arrivalState", () => {
  const start = "2026-11-08T06:00:00.000Z"; // 14:00 Manila
  const end = "2026-11-08T07:00:00.000Z";

  it("is OPEN inside the window", () => {
    expect(arrivalState(start, end, 60, new Date("2026-11-08T05:30:00.000Z"))).toBe("OPEN");
  });

  it("is EARLY before the window opens", () => {
    expect(arrivalState(start, end, 60, new Date("2026-11-08T04:59:00.000Z"))).toBe("EARLY");
  });

  it("is LATE after the appointment ends", () => {
    expect(arrivalState(start, end, 60, new Date("2026-11-08T07:01:00.000Z"))).toBe("LATE");
  });

  it("treats both ends as inclusive, matching the SQL", () => {
    // `check_in_booking` refuses only `now < from` and `now > until`.
    expect(arrivalState(start, end, 60, new Date("2026-11-08T05:00:00.000Z"))).toBe("OPEN");
    expect(arrivalState(start, end, 60, new Date("2026-11-08T07:00:00.000Z"))).toBe("OPEN");
  });

  it("widens with the arrival window", () => {
    const at = new Date("2026-11-08T04:30:00.000Z");
    expect(arrivalState(start, end, 60, at)).toBe("EARLY");
    expect(arrivalState(start, end, 120, at)).toBe("OPEN");
  });
});

describe("admissionBlocker", () => {
  const now = new Date("2026-11-08T06:30:00.000Z");
  const open: ArrivalFacts = {
    status: "CONFIRMED",
    passUsed: false,
    passRevoked: false,
    passExpiresAt: "2026-11-09T07:00:00.000Z",
    depositDue: false,
  };

  it("admits a clean arrival", () => {
    expect(admissionBlocker(open, "OPEN", now)).toBeNull();
  });

  it("catches a guest who is already inside", () => {
    expect(admissionBlocker({ ...open, status: "CHECKED_IN" }, "OPEN", now)).toBe(
      "ALREADY_CHECKED_IN"
    );
    // The token is the authority even if the status somehow lags.
    expect(admissionBlocker({ ...open, passUsed: true }, "OPEN", now)).toBe("ALREADY_CHECKED_IN");
  });

  it("says the booking is closed rather than blaming the pass", () => {
    for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"]) {
      expect(admissionBlocker({ ...open, status }, "OPEN", now)).toBe("BOOKING_CLOSED");
    }
  });

  it("names a revoked pass", () => {
    expect(admissionBlocker({ ...open, passRevoked: true }, "OPEN", now)).toBe("PASS_REVOKED");
  });

  it("sends an unpaid deposit to the desk", () => {
    expect(admissionBlocker({ ...open, depositDue: true }, "OPEN", now)).toBe("DEPOSIT_DUE");
  });

  it("catches a pass past its transport expiry", () => {
    const expired = { ...open, passExpiresAt: "2026-11-08T06:00:00.000Z" };
    expect(admissionBlocker(expired, "OPEN", now)).toBe("PASS_EXPIRED");
  });

  it("reports the time as the last thing wrong, not the first", () => {
    expect(admissionBlocker({ ...open, depositDue: true }, "EARLY", now)).toBe("DEPOSIT_DUE");
    expect(admissionBlocker(open, "EARLY", now)).toBe("TOO_EARLY");
    expect(admissionBlocker(open, "LATE", now)).toBe("TOO_LATE");
  });

  it("prefers 'cancelled' over 'expired' for a booking that is both", () => {
    const both = { ...open, status: "CANCELLED", passExpiresAt: "2026-11-01T00:00:00.000Z" };
    expect(admissionBlocker(both, "OPEN", now)).toBe("BOOKING_CLOSED");
  });
});
