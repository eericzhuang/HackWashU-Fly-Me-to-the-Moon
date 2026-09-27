import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listScans, resolveScanFile } from "../../server/scans";

describe("resolveScanFile", () => {
  it("allows step pages and alignment-review images", () => {
    for (const f of ["steps.json", "step_0_0.png", "step_12_3.png", "review_ref.png", "review_4.png"]) {
      expect(resolveScanFile("/o", "latest", f)).toBe(join("/o", "latest", f));
    }
  });

  it("allows contract files in known scan folders", () => {
    expect(resolveScanFile("/o", "latest", "meta.json")).toBe(join("/o", "latest", "meta.json"));
    expect(resolveScanFile("/o", "sim", "reveal.png")).toBe(join("/o", "sim", "reveal.png"));
    expect(resolveScanFile("/o", "scan_20260926_005757", "dir_3.png")).toBe(
      join("/o", "scan_20260926_005757", "dir_3.png"),
    );
  });

  it("rejects unknown folders, unknown files and traversal", () => {
    expect(resolveScanFile("/o", "..", "meta.json")).toBeNull();
    expect(resolveScanFile("/o", "cameras", "meta.json")).toBeNull();
    expect(resolveScanFile("/o", "latest", "../rig.json")).toBeNull();
    expect(resolveScanFile("/o", "latest", "raw")).toBeNull();
    expect(resolveScanFile("/o", "latest", "explain.png")).toBeNull();
    expect(resolveScanFile("/o", "latest", "review_answer.json")).toBeNull(); // write-only
    expect(resolveScanFile("/o", "latest", "step_0_0.png.tmp")).toBeNull();
  });
});

describe("listScans", () => {
  it("lists folders with a meta.json: latest, sim, then newest scan first", () => {
    const out = mkdtempSync(join(tmpdir(), "out-"));
    for (const name of ["scan_20260925_120000", "sim", "scan_20260926_005757", "latest", "cameras"]) {
      mkdirSync(join(out, name));
      writeFileSync(join(out, name, "meta.json"), "{}");
    }
    mkdirSync(join(out, "scan_20260101_000000")); // no meta.json: skipped
    expect(listScans(out)).toEqual(["latest", "sim", "scan_20260926_005757", "scan_20260925_120000"]);
  });

  it("returns [] when out/ does not exist", () => {
    expect(listScans(join(tmpdir(), "terminator-missing-out-dir"))).toEqual([]);
  });
});
