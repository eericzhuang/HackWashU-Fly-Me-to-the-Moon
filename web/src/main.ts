import "./style.css";
import { HttpReader } from "./ai/reader";
import { SilentVoice } from "./audio/voice";
import { ReplayFeed } from "./feed/replayFeed";
import { DomStage } from "./scene/domStage";
import { Director } from "./show/director";
import { DomOverlay } from "./ui/overlay";

// Replay only for now: ?replay=sim&pace=2500 plays a finished scan folder as if live.
// Task 9 adds the live feed, speech and keyboard controls.
const params = new URLSearchParams(location.search);
const director = new Director(
  new DomStage(document.querySelector<HTMLElement>("#stage")!),
  new DomOverlay(document.querySelector<HTMLElement>("#overlay")!),
  new HttpReader(),
  new SilentVoice(),
);
new ReplayFeed(params.get("replay") ?? "sim", Number(params.get("pace")) || 6000).start((e) => director.handle(e));
