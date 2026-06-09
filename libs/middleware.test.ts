import { describe, expect, it } from "bun:test";
import type { AvailableDaysQuery, AvailableDaysResult } from "./client";
import { altchaCaptchaMiddleware } from "./middleware";

const query: AvailableDaysQuery = {
  officeId: 10461,
  serviceId: 10339028,
  startDate: "2026-06-01",
  endDate: "2026-09-01",
};

describe("altchaCaptchaMiddleware", () => {
  it("passes through when days are returned (no captcha needed)", async () => {
    let solves = 0;
    const mw = altchaCaptchaMiddleware(async () => {
      solves++;
      return "tok";
    });
    const result = await mw.handle(query, async () => ({ days: ["2026-06-10"] }));
    expect(result.days).toEqual(["2026-06-10"]);
    expect(solves).toBe(0);
  });

  it("does not solve for non-captcha errors", async () => {
    let solves = 0;
    const mw = altchaCaptchaMiddleware(async () => {
      solves++;
      return "tok";
    });
    const result = await mw.handle(query, async () => ({
      days: null,
      status: 500,
      errorCodes: ["serverError"],
    }));
    expect(result.days).toBeNull();
    expect(solves).toBe(0);
  });

  it("solves and retries once on captchaMissing", async () => {
    const tokens: (string | null | undefined)[] = [];
    const next = async (q: AvailableDaysQuery): Promise<AvailableDaysResult> => {
      tokens.push(q.captchaToken);
      return tokens.length === 1
        ? { days: null, status: 400, errorCodes: ["captchaMissing"] }
        : { days: ["2026-08-08"] };
    };
    const mw = altchaCaptchaMiddleware(async () => "TOKEN");
    const result = await mw.handle(query, next);
    expect(tokens).toEqual([undefined, "TOKEN"]);
    expect(result.days).toEqual(["2026-08-08"]);
  });
});
