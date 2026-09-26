import "./style.css";
import { HttpReader } from "./ai/reader";
import { BrowserVoice } from "./audio/voice";
import { ReplayFeed } from "./feed/replayFeed";
import { ScanFeed } from "./feed/scanFeed";
import type { FeedEvent } from "./feed/types";
import { DomStage } from "./scene/domStage";
import { Director } from "./show/director";
import { bindKeys } from "./show/keys";
import { DomOverlay } from "./ui/overlay";

// URL options:
//   ?replay=sim&pace=6000   play a finished scan folder as if live (development, or the backup demo)
//   ?scan=latest            which folder the live feed watches (default: latest)
const params = new URLSearchParams(location.search);
const replayName = params.get("replay");
const pace = Number(params.get("pace")) || 6000;

const voice = new BrowserVoice();
const director = new Director(
  new DomStage(document.querySelector<HTMLElement>("#stage")!),
  new DomOverlay(document.querySelector<HTMLElement>("#overlay")!),
  new HttpReader(),
  voice,
);
const play = (e: FeedEvent) => director.handle(e);

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
  arm: () => director.arm(),
  skip: () => director.skip(),
  replay: () => startReplay(replayName ?? live!.name),
  idle: () => {
    replay?.stop();
    director.toIdle();
  },
  mute: () => {
    voice.muted = !voice.muted;
  },
  fullscreen: () => {
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  },
});
