/*
 * Availability-request middleware.
 *
 * A middleware wraps each `available-days` request and may inspect the result,
 * adjust the query, and retry — exactly how the Altcha bot-verification is
 * injected into the client without polluting the core request path.
 */

import type { AvailableDaysQuery, AvailableDaysResult } from "./client";

/** Performs (or forwards) an availability request. */
export type AvailabilityHandler = (query: AvailableDaysQuery) => Promise<AvailableDaysResult>;

/** Wraps an availability request; calls `next` to continue the chain. */
export interface AvailabilityMiddleware {
  readonly name: string;
  handle(query: AvailableDaysQuery, next: AvailabilityHandler): Promise<AvailableDaysResult>;
}

/**
 * Injectable Altcha verification. It activates only for the services that
 * actually demand a captcha — i.e. when the API answers `captchaMissing` — then
 * solves the proof-of-work, injects the token, and retries the request once.
 */
export function altchaCaptchaMiddleware(
  solveCaptcha: () => Promise<string>,
  log: (...args: unknown[]) => void = () => {},
): AvailabilityMiddleware {
  return {
    name: "altcha-captcha",
    async handle(query, next) {
      const result = await next(query);

      const needsVerification =
        result.days === null && (result.errorCodes?.includes("captchaMissing") ?? false);
      if (!needsVerification) return result;

      log(`[altcha] service ${query.serviceId} requires verification — solving captcha…`);
      const captchaToken = await solveCaptcha();
      log(`[altcha] verification solved — retrying request with token`);
      return next({ ...query, captchaToken });
    },
  };
}
