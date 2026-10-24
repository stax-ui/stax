import "./styles.css";

import { hydrate } from "@stax-ui/dom/hydrate";
import { makeClientLayer } from "@stax-ui/platform";

import { DocLayout } from "./layout.js";
import { router } from "./routes.js";

// TodoApp provides its own `Storage` layer internally (env-aware pick
// between StorageLive and StorageNoOp), so hydrate only needs the
// platform's client layer here. `makeClientLayer` is `Layer<…, never,
// never>` so `hydrate`'s `L extends Layer<never, never, never>`
// constraint satisfies cleanly and `Layer.Success<L>` carries
// `NavigationContext | RouteDataProvider` into the element's R.
hydrate(DocLayout(), document.getElementById("root")!, {
  layers: makeClientLayer(router),
});
