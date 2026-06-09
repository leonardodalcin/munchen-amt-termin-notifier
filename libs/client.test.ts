import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { type AvailableDaysQuery, MunichTerminClient } from "./client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type StubHandler = (url: string) => { status: number; body: unknown };
function stubFetch(handler: StubHandler): void {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const baseQuery: AvailableDaysQuery = {
  officeId: 10308174,
  serviceId: 1071896,
  startDate: "2026-06-01",
  endDate: "2026-09-01",
};

describe("MunichTerminClient.availableDays", () => {
  it("returns the available days", async () => {
    stubFetch(() => ({ status: 200, body: { availableDays: ["2026-06-10", "2026-06-11"] } }));
    const client = new MunichTerminClient({ logger: () => {} });
    const result = await client.availableDays(baseQuery);
    expect(result.days).toEqual(["2026-06-10", "2026-06-11"]);
  });

  it("treats noAppointmentForThisDay (404) as no slots", async () => {
    stubFetch(() => ({
      status: 404,
      body: { errors: [{ errorCode: "noAppointmentForThisDay" }] },
    }));
    const client = new MunichTerminClient({ logger: () => {} });
    const result = await client.availableDays(baseQuery);
    expect(result.days).toEqual([]);
  });

  it("surfaces an unexpected error as days=null", async () => {
    stubFetch(() => ({ status: 500, body: { errors: [{ errorCode: "serverError" }] } }));
    const client = new MunichTerminClient({ logger: () => {} });
    const result = await client.availableDays(baseQuery);
    expect(result.days).toBeNull();
    expect(result.errorCodes).toContain("serverError");
  });

  it("solves the Altcha captcha and retries when required", async () => {
    const salt = "s4lt";
    const challenge = createHash("sha256")
      .update(salt + "0")
      .digest("hex");
    stubFetch((url) => {
      if (url.includes("/captcha-challenge/")) {
        return {
          status: 200,
          body: { algorithm: "SHA-256", challenge, salt, signature: "sig", maxnumber: 100 },
        };
      }
      if (url.includes("/captcha-verify/")) {
        return { status: 200, body: { token: "JWT-TEST", meta: { success: true } } };
      }
      if (url.includes("captchaToken=")) {
        return { status: 200, body: { availableDays: ["2026-07-01"] } };
      }
      return { status: 400, body: { errors: [{ errorCode: "captchaMissing" }] } };
    });
    const client = new MunichTerminClient({ logger: () => {} });
    const result = await client.availableDays(baseQuery);
    expect(result.days).toEqual(["2026-07-01"]);
  });

  it("redacts the captcha token from logs", async () => {
    stubFetch(() => ({ status: 200, body: { availableDays: [] } }));
    const logs: string[] = [];
    const client = new MunichTerminClient({ logger: (...a) => logs.push(a.map(String).join(" ")) });
    await client.availableDays({ ...baseQuery, captchaToken: "SECRET-JWT" });
    const joined = logs.join("\n");
    expect(joined).toContain("captchaToken=<redacted>");
    expect(joined).not.toContain("SECRET-JWT");
  });
});
