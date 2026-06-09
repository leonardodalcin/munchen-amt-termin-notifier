import { describe, expect, it } from "bun:test";
import {
  isOfficeId,
  isServiceId,
  officeName,
  officesForService,
  serviceName,
  toOfficeId,
  toServiceId,
} from "./catalog";

describe("catalog", () => {
  it("validates service ids", () => {
    expect(isServiceId(1071896)).toBe(true);
    expect(isServiceId(99999999)).toBe(false);
    expect(toServiceId(1071896)).toBe(1071896);
    expect(() => toServiceId(99999999)).toThrow(/Unknown serviceId/);
  });

  it("validates office ids", () => {
    expect(isOfficeId(10308174)).toBe(true);
    expect(isOfficeId(99999999)).toBe(false);
    expect(toOfficeId(10308174)).toBe(10308174);
    expect(() => toOfficeId(99999999)).toThrow(/Unknown officeId/);
  });

  it("resolves names and offices", () => {
    expect(serviceName(1071896)).toContain("Führerschein");
    expect(officeName(10308174)).toContain("Führerscheinstelle");
    expect(officesForService(1071896)).toContain(10308174);
    expect(officesForService(10339028)).toContain(10461);
  });
});
