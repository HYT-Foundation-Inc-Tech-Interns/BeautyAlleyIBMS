/**
 * The owner's brief, without a database.
 *
 * What is worth testing here is not the arithmetic - that is one division - but
 * the editorial order: which of several true things the brief calls out, and
 * what it says when it has no baseline to compare against.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const format = require("../../scripts/brief-format");

type Totals = {
  bookings: number;
  completed: number;
  cancelled: number;
  noShow: number;
  checkedIn: number;
  revenueCents: number;
};

type Brief = {
  date: string;
  weekday: string;
  totals: Totals;
  topService: { name: string; bookings: number; revenueCents: number } | null;
  retention: { clientsSeen: number; rebooked: number };
  utilisation: { bookedMinutes: number; staffedMinutes: number };
  trailing: {
    weeks: number;
    avgRevenueCents: number;
    avgBookings: number;
    avgNoShow: number;
    avgCancelled: number;
  };
};

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    date: "2026-11-10",
    weekday: "Tuesday",
    totals: {
      bookings: 18,
      completed: 14,
      cancelled: 2,
      noShow: 0,
      checkedIn: 16,
      revenueCents: 1_240_000,
    },
    topService: { name: "Korean Glass Skin", bookings: 5, revenueCents: 900_000 },
    retention: { clientsSeen: 12, rebooked: 7 },
    utilisation: { bookedMinutes: 1080, staffedMinutes: 1620 },
    trailing: {
      weeks: 4,
      avgRevenueCents: 1_840_000,
      avgBookings: 16,
      avgNoShow: 0.5,
      avgCancelled: 1.2,
    },
    ...overrides,
  };
}

describe("money", () => {
  it("drops the centavos when they are zero", () => {
    expect(format.money(1_240_000)).toBe("₱12,400");
  });

  it("keeps them when they are not", () => {
    expect(format.money(1_240_050)).toBe("₱12,400.50");
  });

  it("treats a missing value as zero", () => {
    expect(format.money(undefined)).toBe("₱0");
  });
});

describe("duration", () => {
  it("says hours and minutes", () => {
    expect(format.duration(552)).toBe("9h 12m");
  });

  it("says minutes alone under an hour", () => {
    expect(format.duration(45)).toBe("45m");
  });

  it("drops the minutes on the hour", () => {
    expect(format.duration(1620)).toBe("27h");
  });
});

describe("utilisationPct", () => {
  it("rounds to a whole percentage", () => {
    expect(format.utilisationPct({ bookedMinutes: 552, staffedMinutes: 1620 })).toBe(34);
  });

  it("is null when nobody was on the rota, not 0 or 100", () => {
    expect(format.utilisationPct({ bookedMinutes: 0, staffedMinutes: 0 })).toBeNull();
  });
});

describe("dateLabel", () => {
  it("reads the date without drifting a day", () => {
    expect(format.dateLabel(brief())).toBe("Tuesday 10 November");
  });
});

describe("pickAnomaly", () => {
  it("says nothing on an ordinary day", () => {
    expect(format.pickAnomaly(brief())).toBeNull();
  });

  it("leads with an empty staffed day", () => {
    const anomaly = format.pickAnomaly(
      brief({
        totals: { bookings: 0, completed: 0, cancelled: 0, noShow: 0, checkedIn: 0, revenueCents: 0 },
        utilisation: { bookedMinutes: 0, staffedMinutes: 1620 },
      }),
    );
    expect(anomaly.kind).toBe("empty");
    expect(anomaly.text).toContain("27h");
  });

  it("calls out no-shows at twice the weekday average", () => {
    const anomaly = format.pickAnomaly(
      brief({ totals: { ...brief().totals, noShow: 2 } }),
    );
    expect(anomaly.kind).toBe("no-shows");
    expect(anomaly.text).toContain("0.5");
    expect(anomaly.text).toContain("an average Tuesday");
  });

  it("leaves a single no-show alone", () => {
    const anomaly = format.pickAnomaly(
      brief({ totals: { ...brief().totals, noShow: 1 } }),
    );
    expect(anomaly).toBeNull();
  });

  it("calls out a run of cancellations", () => {
    const anomaly = format.pickAnomaly(
      brief({ totals: { ...brief().totals, cancelled: 3 } }),
    );
    expect(anomaly.kind).toBe("cancellations");
  });

  it("reports takings well under the weekday's own baseline", () => {
    const anomaly = format.pickAnomaly(
      brief({ totals: { ...brief().totals, revenueCents: 600_000 } }),
    );
    expect(anomaly.kind).toBe("revenue");
    expect(anomaly.text).toContain("33%");
  });

  it("falls back to idle chairs when takings are in line but the day was thin", () => {
    const anomaly = format.pickAnomaly(
      brief({
        utilisation: { bookedMinutes: 300, staffedMinutes: 1620 },
      }),
    );
    expect(anomaly.kind).toBe("idle");
  });

  it("does not dress an absolute count up as a trend without a baseline", () => {
    const anomaly = format.pickAnomaly(
      brief({
        trailing: {
          weeks: 0,
          avgRevenueCents: 0,
          avgBookings: 0,
          avgNoShow: 0,
          avgCancelled: 0,
        },
        totals: { ...brief().totals, noShow: 2 },
      }),
    );
    expect(anomaly.kind).toBe("no-shows");
    expect(anomaly.text).toContain("no earlier Tuesday");
  });
});

describe("subjectFor", () => {
  it("carries the date, the takings and the no-shows", () => {
    expect(format.subjectFor(brief({ totals: { ...brief().totals, noShow: 2 } }))).toBe(
      "Tuesday 10 November — ₱12,400 · 2 no-shows",
    );
  });

  it("leaves the tail off when nobody missed an appointment", () => {
    expect(format.subjectFor(brief())).toBe("Tuesday 10 November — ₱12,400");
  });
});

describe("lines", () => {
  it("compares revenue with the target when one is configured", () => {
    const revenue = format.lines(brief(), { targetCents: 2_000_000 })[0];
    expect(revenue[1]).toContain("₱20,000 target");
    expect(revenue[1]).toContain("62%");
  });

  it("does not invent a comparison when there is no target", () => {
    const revenue = format.lines(brief())[0];
    expect(revenue[1]).toBe("₱12,400");
  });

  it("pluralises the no-show count", () => {
    const none = format.lines(brief())[1][1];
    expect(none).toContain("0 no-shows");

    const one = format.lines(brief({ totals: { ...brief().totals, noShow: 1 } }))[1][1];
    expect(one).toContain("1 no-show");
    expect(one).not.toContain("1 no-shows");
  });
});

describe("textBody", () => {
  it("ends with the one thing to watch", () => {
    const text = format.textBody(brief({ totals: { ...brief().totals, noShow: 2 } }));
    expect(text).toContain("Watch:");
    expect(text).toContain("Tuesday 10 November");
  });

  it("says so plainly when nothing is wrong", () => {
    expect(format.textBody(brief())).toContain("Nothing unusual.");
  });
});

describe("htmlBody", () => {
  it("escapes a service name rather than rendering it", () => {
    const html = format.htmlBody(
      brief({ topService: { name: '<script>alert(1)</script>', bookings: 1, revenueCents: 100 } }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
