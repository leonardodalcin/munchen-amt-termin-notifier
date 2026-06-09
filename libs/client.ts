/*
 * MunichTerminClient — a small Bun client for the City of Munich citizen
 * appointment API ("Bürgeransicht" / ZMS).
 *
 * It can:
 *   - discover services + offices and their IDs (getServices / getOffices /
 *     getOfficesAndServices),
 *   - check available days for any service (getAvailableDays / availableDaysAuto),
 *   - transparently solve the Altcha proof-of-work captcha that gates the
 *     high-demand services (e.g. immigration / Aufenthaltstitel) via the public
 *     www48 challenge/verify endpoints — works from anywhere, no proxy needed.
 *
 * An optional `proxy` (or MUC_PROXY_URL / HTTPS_PROXY) is still honoured if you
 * want to route requests through one, but it is not required.
 */

import { createHash } from "node:crypto";
import type { OfficeId, ServiceId } from "./catalog";

export const DEFAULT_BASE: string =
  process.env.API_BASE || "https://www48.muenchen.de/buergeransicht/api/citizen";

export interface ClientOptions {
  baseUrl?: string;
  proxy?: string;
  debug?: boolean;
}

export interface Service {
  id: number;
  name: string;
  maxQuantity?: number | null;
  [key: string]: unknown;
}

export interface OfficeAddress {
  street: string;
  house_number: string;
  [key: string]: unknown;
}

export interface Office {
  id: number;
  name: string;
  address?: OfficeAddress;
  [key: string]: unknown;
}

export interface Relation {
  officeId: number;
  serviceId: number;
  slots: number;
  public: boolean;
  maxQuantity: number;
}

export interface OfficesAndServices {
  offices: Office[];
  services: Service[];
  relations: Relation[];
}

export interface CaptchaDetails {
  siteKey?: string;
  captchaChallenge: string;
  captchaVerify: string;
  captchaEnabled: boolean;
}

export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber?: number;
}

export interface ApiError {
  errorCode: string;
  statusCode?: number;
  errorType?: string;
  errorMessage?: string;
}

export interface AvailableDaysQuery {
  officeId: OfficeId;
  serviceId: ServiceId;
  serviceCount?: string | number;
  startDate: string;
  endDate: string;
  captchaToken?: string | null;
}

export interface AvailableDaysResult {
  /** Array of "YYYY-MM-DD" days (possibly empty), or null on an unexpected error. */
  days: string[] | null;
  status?: number;
  errors?: ApiError[];
  errorCodes?: string[];
}

/** Bun's fetch accepts a per-request `proxy`; widen the standard type for it. */
type FetchInit = RequestInit & { proxy?: string };

export class MunichTerminClient {
  readonly baseUrl: string;
  readonly proxy: string | undefined;
  readonly debug: boolean;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.proxy = options.proxy ?? process.env.MUC_PROXY_URL ?? process.env.HTTPS_PROXY ?? undefined;
    this.debug = options.debug ?? !!process.env.DEBUG;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.error("[client]", ...args);
  }

  private fetch(url: string, opts: FetchInit = {}): Promise<Response> {
    const init: FetchInit = {
      ...opts,
      headers: { Accept: "application/json", ...(opts.headers as Record<string, string>) },
    };
    if (this.proxy) init.proxy = this.proxy;
    return fetch(url, init);
  }

  private async json<T>(
    url: string,
    opts?: FetchInit,
  ): Promise<{ res: Response; body: Partial<T> }> {
    const res = await this.fetch(url, opts);
    const body = (await res.json().catch(() => ({}))) as Partial<T>;
    return { res, body };
  }

  async getServices(): Promise<Service[]> {
    const { body } = await this.json<{ services: Service[] }>(`${this.baseUrl}/services/`);
    return body.services ?? [];
  }

  async getOffices(): Promise<Office[]> {
    const { body } = await this.json<{ offices: Office[] }>(`${this.baseUrl}/offices/`);
    return body.offices ?? [];
  }

  /** { offices, services, relations } — relations map serviceId <-> officeId. */
  async getOfficesAndServices(): Promise<OfficesAndServices> {
    const { body } = await this.json<OfficesAndServices>(`${this.baseUrl}/offices-and-services/`);
    return {
      offices: body.offices ?? [],
      services: body.services ?? [],
      relations: body.relations ?? [],
    };
  }

  async getCaptchaDetails(): Promise<CaptchaDetails> {
    const { body } = await this.json<CaptchaDetails>(`${this.baseUrl}/captcha-details/`);
    return body as CaptchaDetails;
  }

  /** Brute-force the Altcha proof-of-work: find n where sha256(salt + n) === challenge. */
  private solvePow(ch: AltchaChallenge): number | null {
    const max = Number.isFinite(ch.maxnumber) ? (ch.maxnumber as number) : 1_000_000;
    for (let n = 0; n <= max; n++) {
      if (
        createHash("sha256")
          .update(ch.salt + n)
          .digest("hex") === ch.challenge
      )
        return n;
    }
    return null;
  }

  /*
   * Solve the Altcha captcha that gates high-demand services and return a
   * `captchaToken` for `available-days`. The public www48 endpoints proxy the
   * captcha for us, so this works from anywhere — no German egress required:
   *   1. GET  /captcha-challenge/  -> Altcha challenge
   *   2. solve the proof-of-work
   *   3. POST /captcha-verify/ { payload } -> { token } (a signed JWT)
   */
  async solveCaptcha(): Promise<string> {
    const t0 = Date.now();
    const chRes = await this.fetch(`${this.baseUrl}/captcha-challenge/`);
    if (!chRes.ok) throw new Error(`captcha challenge HTTP ${chRes.status}`);
    const ch = (await chRes.json()) as AltchaChallenge;

    const number = this.solvePow(ch);
    if (number == null) throw new Error("captcha PoW not found within maxnumber");
    this.log(`solved PoW n=${number} in ${Date.now() - t0}ms`);

    const payload = Buffer.from(
      JSON.stringify({
        algorithm: ch.algorithm,
        challenge: ch.challenge,
        number,
        salt: ch.salt,
        signature: ch.signature,
      }),
    ).toString("base64");

    const vRes = await this.fetch(`${this.baseUrl}/captcha-verify/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    const verify = (await vRes.json().catch(() => ({}))) as {
      token?: string;
      meta?: { success?: boolean; error?: string };
    };
    if (!vRes.ok || !verify.token) {
      throw new Error(
        `captcha verify failed: HTTP ${vRes.status} ${verify.meta?.error ?? ""}`.trim(),
      );
    }
    this.log(`captcha verified in ${Date.now() - t0}ms`);
    return verify.token;
  }

  /** Available days for a service. `days` is null on an unexpected error. */
  async getAvailableDays(query: AvailableDaysQuery): Promise<AvailableDaysResult> {
    const params = new URLSearchParams({
      officeId: String(query.officeId),
      serviceId: String(query.serviceId),
      serviceCount: String(query.serviceCount ?? 1),
      startDate: query.startDate,
      endDate: query.endDate,
    });
    if (query.captchaToken) params.set("captchaToken", query.captchaToken);

    const { res, body } = await this.json<{ availableDays: string[]; errors: ApiError[] }>(
      `${this.baseUrl}/available-days/?${params}`,
    );
    if (Array.isArray(body.availableDays)) return { days: body.availableDays };

    const errors = body.errors ?? [];
    const errorCodes = errors.map((e) => e.errorCode);
    // 404 + noAppointmentForThisScope is the API's normal "nothing free" answer.
    if (res.status === 404 || errorCodes.includes("noAppointmentForThisScope")) return { days: [] };

    return { days: null, status: res.status, errors, errorCodes };
  }

  /** Like getAvailableDays, but transparently solves the captcha when required. */
  async availableDaysAuto(query: AvailableDaysQuery): Promise<AvailableDaysResult> {
    let result = await this.getAvailableDays(query);
    if (result.days === null && result.errorCodes?.includes("captchaMissing")) {
      this.log("captcha required — solving…");
      const captchaToken = await this.solveCaptcha();
      result = await this.getAvailableDays({ ...query, captchaToken });
    }
    return result;
  }
}
