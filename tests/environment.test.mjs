import { describe, expect, it } from "vitest";
import { environmentFor, seasonFor } from "../dashboard/src/environment.ts";

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
