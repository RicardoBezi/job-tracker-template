import { describe, expect, it } from "vitest";
import { environmentFor, seasonFor } from "../dashboard/src/environment.ts";
import { FESTIVALS, festivalFor, glyphFor } from "../dashboard/src/calendar.ts";
import { classifyWeather } from "../dashboard/src/weather.ts";
import { diffTransmissionSnapshots, snapshotFor } from "../dashboard/src/cinematic.ts";

const at = (month, hour, minute = 0) => new Date(2026, month - 1, 8, hour, minute, 0);

describe("calendar atmosphere", () => {
  it("treats November through February as winter", () => {
    for (const month of [11, 12, 1, 2]) expect(seasonFor(at(month, 12)).key).toBe("winter");
  });

  it("maps the remaining months to spring, summer, and autumn", () => {
    expect(seasonFor(at(3, 12)).key).toBe("spring");
    expect(seasonFor(at(5, 12)).key).toBe("spring");
    expect(seasonFor(at(6, 12)).key).toBe("summer");
    expect(seasonFor(at(8, 12)).key).toBe("summer");
    expect(seasonFor(at(9, 12)).key).toBe("autumn");
    expect(seasonFor(at(10, 12)).key).toBe("autumn");
  });
});

describe("24-hour color wheel", () => {
  it("moves through distinct hues instead of a binary day/night theme", () => {
    const hues = [0, 4, 7, 10, 12, 16, 19, 22].map((hour) => Math.round(environmentFor(at(6, hour)).hue));
    expect(new Set(hues).size).toBeGreaterThanOrEqual(7);
  });

  it("advances continuously within a phase", () => {
    const early = environmentFor(at(6, 14, 0));
    const later = environmentFor(at(6, 14, 30));
    expect(later.dayProgress).toBeGreaterThan(early.dayProgress);
    expect(later.hue).not.toBe(early.hue);
    expect(later.phase.en).toBe(early.phase.en);
  });

  it("allows live pipeline stage and data momentum to influence the signal", () => {
    const applied = environmentFor(at(6, 12), "applied", 0.2);
    const interview = environmentFor(at(6, 12), "interview", 0.2);
    const energized = environmentFor(at(6, 12), "applied", 1);
    expect(interview.hue).not.toBe(applied.hue);
    expect(energized.signal).not.toBe(applied.signal);
  });
});

describe("six-hour seasonal glyphs", () => {
  it("uses a distinct background character for every season and interval", () => {
    const glyphs = ["winter", "spring", "summer", "autumn"].flatMap((season) =>
      [0, 6, 12, 18].map((hour) => glyphFor(at(1, hour), season).glyph));
    expect(glyphs).toHaveLength(16);
    expect(new Set(glyphs).size).toBe(16);
  });

  it("changes exactly at each six-hour boundary", () => {
    expect(glyphFor(at(1, 5, 59), "winter").slot).toBe("00–06");
    expect(glyphFor(at(1, 6), "winter").slot).toBe("06–12");
    expect(glyphFor(at(1, 12), "winter").slot).toBe("12–18");
    expect(glyphFor(at(1, 18), "winter").slot).toBe("18–24");
  });
});

describe("curated 2026 cultural calendar", () => {
  const on = (iso) => new Date(`${iso}T12:00:00`);

  it("keeps every curated event reachable", () => {
    for (const festival of FESTIVALS) expect(festivalFor(on(festival.start))).not.toBeNull();
  });

  it("lets specific celebrations override their surrounding holiday period", () => {
    expect(festivalFor(on("2026-02-16"))?.key).toBe("cny-eve");
    expect(festivalFor(on("2026-02-17"))?.key).toBe("cny-day");
    expect(festivalFor(on("2026-05-05"))?.key).toBe("childrens-day");
    expect(festivalFor(on("2026-05-04"))?.key).toBe("golden-week");
  });

  it("combines celebrations that land on the same date", () => {
    const festival = festivalFor(on("2026-03-03"));
    expect(festival?.region).toBe("JP · CN");
    expect(festival?.name).toBe("HINA + LANTERN FESTIVAL");
  });

  it("does not promote visually generic statutory holidays", () => {
    expect(festivalFor(on("2026-02-11"))).toBeNull();
    expect(festivalFor(on("2026-03-20"))).toBeNull();
    expect(festivalFor(on("2026-07-20"))).toBeNull();
    expect(festivalFor(on("2026-11-23"))).toBeNull();
  });
});

describe("ambient weather classification", () => {
  it("maps WMO conditions into visual atmosphere families", () => {
    expect(classifyWeather(0)).toBe("clear");
    expect(classifyWeather(3)).toBe("cloudy");
    expect(classifyWeather(45)).toBe("fog");
    expect(classifyWeather(61)).toBe("rain");
    expect(classifyWeather(75)).toBe("snow");
    expect(classifyWeather(95)).toBe("storm");
  });
});

describe("transmission arrival detection", () => {
  const application = {
    id: "route-01",
    company: "Apex Industries",
    role: "Signal Designer",
    status: "applied",
    last_activity_at: "2026-08-08T12:00:00.000Z",
    last_email_id: "mail-01",
    source: "email",
    ghosted: false,
  };

  it("silently establishes a baseline on the first visit", () => {
    expect(diffTransmissionSnapshots(null, [application])).toEqual([]);
  });

  it("does not announce unchanged records", () => {
    expect(diffTransmissionSnapshots(snapshotFor([application]), [application])).toEqual([]);
  });

  it("announces new and updated routes", () => {
    const previous = snapshotFor([application]);
    const updated = { ...application, status: "interview", last_email_id: "mail-02" };
    const fresh = { ...application, id: "route-02", company: "Nova Works", last_email_id: "mail-03" };
    const arrivals = diffTransmissionSnapshots(previous, [updated, fresh]);

    expect(arrivals.map((arrival) => [arrival.id, arrival.arrival])).toEqual([
      ["route-01", "updated"],
      ["route-02", "new"],
    ]);
  });
});
