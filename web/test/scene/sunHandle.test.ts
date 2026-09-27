import { describe, expect, it } from "vitest";
import { SunHandle } from "../../src/scene/sunHandle";

describe("SunHandle", () => {
  it("reports the follower's azimuth and elevation in radians", () => {
    const handle = Object.create(SunHandle.prototype) as SunHandle;
    Object.assign(handle, { follower: { azimuth: Math.PI / 2, elevation: Math.PI / 6 } });
    expect(handle.angles()).toEqual({ azimuth: Math.PI / 2, elevation: Math.PI / 6 });
  });
});
