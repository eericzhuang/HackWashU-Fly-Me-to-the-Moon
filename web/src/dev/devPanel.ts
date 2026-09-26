import GUI from "lil-gui";
import { MOON } from "../scene/moon";
import { PLATES } from "../scene/plates";
import { SUN } from "../scene/sunFollower";
import { STAGE, type ThreeStage } from "../scene/threeStage";

/** Live tuning for rehearsals (D): moon relief and exposure, bloom, capture dim, card brightness, page relight. */
export function openDevPanel(stage: ThreeStage): GUI {
  const gui = new GUI({ title: "Terminator tuning (D to close)" });

  const m = stage.moon.uniforms;
  const moon = gui.addFolder("Moon");
  moon.add(m.exaggeration, "value", 1, 12, 0.5).name("relief x");
  moon.add(m.exposure, "value", 0.5, 6, 0.1).name("exposure");
  moon.add(m.earthshine, "value", 0, 0.1, 0.005).name("earthshine");
  moon.add(m.steps, "value", 0, 64, 4).name("shadow steps");
  moon.add(MOON, "tilt", -0.3, 0.6, 0.01).name("sun toward viewer");

  const frame = gui.addFolder("Frame");
  frame.add(stage.engine.bloom, "intensity", 0, 3, 0.05).name("bloom");
  frame.add(stage.engine.bloom.luminanceMaterial, "threshold", 0, 1, 0.01).name("bloom threshold");
  frame.add(STAGE, "captureDim", 0.1, 1, 0.05).name("capture dim (next scan)");
  frame.add(PLATES, "brightness", 0.3, 1.2, 0.05).name("photo brightness (next photo)");

  const p = stage.page.uniforms;
  const page = gui.addFolder("Page relight");
  page.add(p.relief, "value", 0.1, 4, 0.1).name("relief gain");
  page.add(p.sharpLod, "value", 0, 3, 0.25).name("smoothing (mip)");
  page.add(p.blurLod, "value", 3, 8, 0.25).name("flat-field blur (mip)");
  page.add(p.exposure, "value", 0.3, 1.5, 0.02).name("exposure");
  page.add(SUN, "autoElevationDeg", 2, 30, 1).name("idle sun height");

  return gui;
}
