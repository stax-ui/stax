import "./styles.css";

import type { Element } from "@stax-ui/dom";
import { hydrate } from "@stax-ui/dom/hydrate";
import { makeClientLayer } from "@stax-ui/platform/client";

import { App } from "./App.js";
import { router } from "./routes.js";

hydrate(
  App() as unknown as Element.Element<HTMLElement>,
  document.getElementById("root")!,
  {
    layers: makeClientLayer(router),
  },
);
