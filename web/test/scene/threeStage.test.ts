import gsap from "gsap";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DoneUrls } from "../../src/feed/types";
import { STAGE, ThreeStage } from "../../src/scene/threeStage";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function stageWithPendingLoad(promise: Promise<void>) {
  const stage = Object.create(ThreeStage.prototype) as ThreeStage;
  const page = { shows: vi.fn(() => false), load: vi.fn(() => promise), show: vi.fn(), hide: vi.fn() };
  const frameGain = { gain: 1 };
  const sky = new THREE.Color();
  Object.assign(stage, {
    engine: { camera: { position: new THREE.Vector3() }, frameGain },
    look: new THREE.Vector3(), sky, page, moves: [], sceneGeneration: 0,
    plates: { clear: vi.fn() }, sunHandle: { stop: vi.fn() }, moon: { showFull: vi.fn() },
  });
  // Only time is simulated; reveal/reset and the GSAP animations are real.
  Object.assign(stage, { wait: () => Promise.resolve() });
  return { stage, page, frameGain, sky };
}

const urls: DoneUrls = { reveal: "/scan/a/reveal.png", dirs: [] };

afterEach(() => gsap.globalTimeline.clear());

describe("ThreeStage reveal lifecycle", () => {
  it.each(["newScan", "idle"] as const)("does not fade after %s invalidates a pending reveal", async (reset) => {
    const pending = deferred();
    const { stage, page, frameGain, sky } = stageWithPendingLoad(pending.promise);
    const oldReveal = stage.reveal(urls);
    stage[reset]();
    pending.resolve();
    await oldReveal;

    expect(page.show).not.toHaveBeenCalled();
    expect(gsap.getTweensOf(sky)).toHaveLength(0);
    expect(gsap.getTweensOf(frameGain).map((t) => t.vars.gain)).toEqual([
      reset === "newScan" ? STAGE.captureDim : 1,
    ]);
  });
});
