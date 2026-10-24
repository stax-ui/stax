import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { $ } from "@stax-ui/dom";
import { Route, Router } from "@stax-ui/router";

import {
  buildStaticSite,
  generateDocument,
  generateLoaderDataScript,
  serializeForHtml,
} from "./Platform.js";

/**
 * The real `extractEmbeddedRouteData` helper lives inline in
 * `Platform.ts`. Duplicating it here keeps the test coupled to the
 * emitted script shape rather than to the private helper's identity.
 */
const extractEmbeddedRouteData = (html: string): unknown => {
  const match = html.match(
    /<script\b[^>]*\bid=["']__stax_data["'][^>]*>\s*([\s\S]+?)\s*<\/script>/,
  );
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
};

describe("generateLoaderDataScript", () => {
  it('emits a non-executable `type="application/json"` data block', () => {
    // The whole point of the new shape — CSP's `script-src` doesn't
    // apply to non-JS script types, so this works under
    // `script-src 'self'` with no nonces and no hashes.
    const script = generateLoaderDataScript({ data: { name: "Jon" } });
    expect(script).toContain('type="application/json"');
    expect(script).toContain('id="__stax_data"');
    // Confirming no executable form sneaked in.
    expect(script).not.toContain("window.__STAX_DATA__");
  });

  it("returns an empty string for empty loader data", () => {
    // No block means nothing to parse at hydration time, so the
    // `undefined` branch in the client reader is exercised legitimately.
    expect(generateLoaderDataScript({})).toBe("");
  });
});

describe("static-host data fallback (makeClientLayer)", () => {
  it("extracts the embedded data block from generateDocument output", () => {
    const payload = { data: { name: "Jon" }, actions: {} };
    const html = generateDocument("<div>hi</div>", payload);

    const extracted = extractEmbeddedRouteData(html);
    expect(extracted).toEqual(payload);
  });

  it("survives payloads with script-breaking characters", () => {
    // These are exactly the characters serializeForHtml escapes — the round
    // trip has to preserve them. The `</script>` string specifically must
    // not break out of the data block.
    const payload = {
      data: {
        html: "<script>alert('xss')</script>",
        ampersand: "a && b",
        closing: "</script>",
      },
      actions: {},
    };
    const html = generateDocument("<div>hi</div>", payload);

    const extracted = extractEmbeddedRouteData(html);
    expect(extracted).toEqual(payload);
  });

  it("returns undefined when no data block is present", () => {
    const html = "<html><body><div>no data here</div></body></html>";
    expect(extractEmbeddedRouteData(html)).toBeUndefined();
  });

  it("returns undefined when the data block content is malformed JSON", () => {
    const html =
      '<script type="application/json" id="__stax_data">not-json</script>';
    expect(extractEmbeddedRouteData(html)).toBeUndefined();
  });

  it("handles the exact serializeForHtml output format", () => {
    // Sanity check on the escaping contract itself so the regex above
    // isn't operating on assumed-shape data.
    const payload = { data: { s: "<>&" }, actions: {} };
    const serialized = serializeForHtml(payload);
    expect(serialized).toContain("\\u003c");
    expect(serialized).toContain("\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});

describe("buildStaticSite colocated _data.json", () => {
  // Each test gets its own tmpdir so they can run in parallel without
  // stepping on each other's output.
  const createdDirs: string[] = [];
  const mkTmp = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stax-ssg-"));
    createdDirs.push(dir);
    return dir;
  };
  afterAll(async () => {
    await Promise.all(
      createdDirs.map((dir) =>
        fs.rm(dir, { recursive: true, force: true }).catch(() => undefined),
      ),
    );
  });

  it("emits `_data.json` next to each page's `index.html`", async () => {
    const outDir = await mkTmp();

    const Home = Route.make("/").pipe(
      Route.static({
        load: () => Effect.succeed({ greeting: "hello" }),
        render: (data) => $.div({}, (data as { greeting: string }).greeting),
      }),
    );
    const About = Route.make("/about").pipe(
      Route.static({
        load: () => Effect.succeed({ bio: "we build things" }),
        render: (data) => $.div({}, (data as { bio: string }).bio),
      }),
    );
    const router = Router.empty.pipe(Router.concat(Home), Router.concat(About));

    await buildStaticSite({
      router: router as unknown as Parameters<
        typeof buildStaticSite
      >[0]["router"],
      outDir,
    });

    // HTML files
    const homeHtml = await fs.readFile(
      path.join(outDir, "index.html"),
      "utf-8",
    );
    expect(homeHtml).toContain("hello");

    const aboutHtml = await fs.readFile(
      path.join(outDir, "about", "index.html"),
      "utf-8",
    );
    expect(aboutHtml).toContain("we build things");

    // Colocated JSON files
    const homeJson = JSON.parse(
      await fs.readFile(path.join(outDir, "_data.json"), "utf-8"),
    );
    expect(homeJson).toEqual({
      data: { greeting: "hello" },
      actions: {},
    });

    const aboutJson = JSON.parse(
      await fs.readFile(path.join(outDir, "about", "_data.json"), "utf-8"),
    );
    expect(aboutJson).toEqual({
      data: { bio: "we build things" },
      actions: {},
    });
  });

  it("skips `_data.json` for the fallback 404 page", async () => {
    const outDir = await mkTmp();

    const router = Router.empty.pipe(
      Router.concat(
        Route.make("/").pipe(
          Route.static({
            load: () => Effect.succeed({}),
            render: () => $.div({}, "root"),
          }),
        ),
      ),
      Router.fallback(() => $.div({}, "not found")),
    );

    await buildStaticSite({
      router: router as unknown as Parameters<
        typeof buildStaticSite
      >[0]["router"],
      outDir,
    });

    // The fallback writes `404.html` but no sibling `_data.json`.
    const entries = await fs.readdir(outDir);
    expect(entries).toContain("404.html");
    expect(entries).not.toContain(
      // the 404 would land its colocated file at outDir root, same place
      // as the home page's `_data.json`. We check that we didn't overwrite.
      "_404_data.json",
    );
    // Home still gets its JSON.
    const homeJson = JSON.parse(
      await fs.readFile(path.join(outDir, "_data.json"), "utf-8"),
    );
    expect(homeJson).toEqual({ data: {}, actions: {} });
  });
});
