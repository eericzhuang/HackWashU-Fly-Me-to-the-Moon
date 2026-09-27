import "./style.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { HttpReader } from "./ai/reader";
import { BrowserVoice } from "./audio/voice";
import { ToneScore } from "./audio/score";
import { Quindar } from "./audio/quindar";
import { CueVoice } from "./audio/cueVoice";
import { audioKeyActions } from "./audio/controls";
import { ReplayFeed } from "./feed/replayFeed";
import { ScanFeed } from "./feed/scanFeed";
import type { FeedEvent } from "./feed/types";
import { DomStage } from "./scene/domStage";
import { ThreeStage } from "./scene/threeStage";
import { createPanelToggle } from "./dev/panelToggle";
import { Director, type Stage } from "./show/director";
import { bindKeys } from "./show/keys";
import { DomOverlay } from "./ui/overlay";
import { Panels } from "./ui/panels";

// URL options:
//   ?replay=sim&pace=6000   play a finished scan folder as if live (development, or the backup demo)
//   ?scan=latest            which folder the live feed watches (default: latest)
//   ?stage=dom              the CSS stand-in instead of three.js (weak GPU, or no WebGL)
//   ?steps=off              skip the step-by-step pages after a scan (straight to the reveal)
const params = new URLSearchParams(location.search);
const replayName = params.get("replay");
const pace = Number(params.get("pace")) || 6000;
const stageRoot = document.querySelector<HTMLElement>("#stage")!;
const sound = new ToneScore();
const voice = new CueVoice(new BrowserVoice(), new Quindar());

async function makeStage(): Promise<Stage> {
  if (params.get("stage") === "dom") return new DomStage(stageRoot);
  try {
    return await ThreeStage.create(document.querySelector<HTMLElement>("#gl")!, stageRoot,
      (azimuth, elevation) => sound.heldSun(azimuth, elevation));
  } catch (e) {
    console.warn("3D stage unavailable, using the CSS stage:", e);
    return new DomStage(stageRoot);
  }
}

const stage = await makeStage();
const panels = new Panels(document.querySelector<HTMLElement>("#panels")!, params.get("steps") !== "off");
const director = new Director(stage, new DomOverlay(document.querySelector<HTMLElement>("#overlay")!), new HttpReader(),
  voice, sound, panels);
const audioActions = audioKeyActions(director, sound, voice);
const play = (e: FeedEvent) => director.handle(e);

const toggleDevPanel = createPanelToggle(
  stage instanceof ThreeStage,
  () => import("./dev/devPanel").then(({ openDevPanel }) => ({
    open: () => openDevPanel(stage as ThreeStage),
  })),
  (error) => console.warn("Could not open the tuning panel:", error),
);

let replay: ReplayFeed | null = null;
function startReplay(name: string): void {
  replay?.stop();
  replay = new ReplayFeed(name, pace);
  replay.start(play);
}

const live = replayName ? null : new ScanFeed(params.get("scan") ?? "latest");
live?.start((e) => {
  if (e.type === "scanStarted") replay?.stop(); // a real scan always wins over a replay
  play(e);
});
if (replayName) startReplay(replayName);

bindKeys(window, {
  arm: audioActions.arm,
  skip: () => director.skip(),
  // In replay mode R always restarts the replay; live, R must never jump into a running
  // capture or replay a folder that isn't finished yet.
  replay: () => {
    if (replayName) startReplay(replayName);
    else if (live?.current?.phase === "done") startReplay(live.name);
  },
  idle: () => {
    replay?.stop();
    director.toIdle();
  },
  mute: audioActions.mute,
  fullscreen: () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void p.catch(() => {}); // a rejected request (e.g. no user gesture) must not become an unhandled rejection
  },
  dev: () => void toggleDevPanel(),
  panel: (key, shift) => director.key(key, shift),
});

// Dev builds: a handle for checks in the browser console (e.g. __terminator.stage.renderOnce()).
if (import.meta.env.DEV) Object.assign(window, { __terminator: { director, stage } });
