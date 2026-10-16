import { Layer } from "effect";

import { mount, type Element } from "@stax-ui/dom";

import { App } from "./App.js";
import { MediaPlayerLive } from "./MediaPlayer.js";

import "./styles.css";

// `MediaPlayerLive`'s error channel is `MalformedSpec | TransitionLimit`
// — programmer-bug failures the runtime can raise. `mount`'s layer
// slot wants `Layer<_, never, never>`, so we die on either.
mount(App() as Element.Element<HTMLElement>, document.getElementById("root")!, {
  layers: Layer.orDie(MediaPlayerLive),
});
