import { describe, expect, it } from "vitest";
import { initialLang, LANDING, landingFailure, MEL_PROFILES, SOCIAL_ICONS } from "../../src/client/landing";

function allText(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") return [String((v as (a: string) => string)("@ana"))];
  if (Array.isArray(v)) return v.flatMap(allText);
  if (v && typeof v === "object") return Object.values(v).flatMap(allText);
  return [];
}

describe("landing copy", () => {
  it("has the same shape in English and Spanish", () => {
    expect(Object.keys(LANDING.es).sort()).toEqual(Object.keys(LANDING.en).sort());
    expect(LANDING.es.steps).toHaveLength(LANDING.en.steps.length);
    expect(LANDING.es.notes).toHaveLength(LANDING.en.notes.length);
  });

  it("never uses glossary-banned words or em-dashes", () => {
    for (const text of [...allText(LANDING.en), ...allText(LANDING.es)]) {
      expect(text).not.toMatch(/\b(agent|credits?|quota|model answer)\b/i);
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it("tells Spanish readers that practice is in English", () => {
    expect(allText(LANDING.es).join(" ")).toContain("La práctica es en inglés");
  });

  it("picks the saved language, else the browser's", () => {
    expect(initialLang("es", ["en-US"])).toBe("es");
    expect(initialLang(null, ["es-MX", "en"])).toBe("es");
    expect(initialLang(null, ["en-US"])).toBe("en");
    expect(initialLang("fr", [])).toBe("en");
  });

  it("translates the landing form failures, with a fallback", () => {
    expect(landingFailure("es", "invalid_code")).toMatch(/^Ese código/);
    expect(landingFailure("es", "something_new")).toBe(landingFailure("es", "bad_response"));
    expect(landingFailure("en", "rate_limited")).toMatch(/Too many requests/);
  });
});

describe("DM step", () => {
  it("links every listed profile over https, with an icon", () => {
    expect(MEL_PROFILES.length).toBeGreaterThan(0);
    for (const p of MEL_PROFILES) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(SOCIAL_ICONS[p.network]).toContain("<svg");
    }
  });
});
