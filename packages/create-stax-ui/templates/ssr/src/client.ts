import { hydrate } from "@stax-ui/dom/hydrate";
import { makeClientLayer } from "@stax-ui/platform/client";

import { App } from "./App.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: makeClientLayer(router),
});
