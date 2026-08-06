// Bundle to two self-contained pages:
//   dist/index.html    — standalone, open it anywhere
//   dist/artifact.html — body content only, for publishing as an Artifact
//                        (the host wraps it in doctype/head/body itself)
//
// Everything is inlined. No CDN, no external fetches, no build-time network.

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

const minify = !process.argv.includes("--dev");

async function bundle(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "iife",
    target: ["es2020", "safari15"],
    minify,
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

const js = await bundle("src/main.ts");
const shell = await readFile(join(root, "src/shell.html"), "utf8");

await mkdir(dist, { recursive: true });

const body = `${shell}\n<script>\n${js}\n</script>\n`;
await writeFile(join(dist, "artifact.html"), body);

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b0e12">
<title>DrawRace</title>
</head>
<body>
${body}</body>
</html>
`;
await writeFile(join(dist, "index.html"), standalone);

// Slot Racer: the same circuits and the same renderer, a different game on top.
// Built as its own pair of pages rather than a mode inside the first one -- it
// shares no screens, no controls and no save data, so folding it in would mean
// two games arguing over one menu.
const slotJs = await bundle("src/slot/main.ts");
const slotShell = await readFile(join(root, "src/slot/shell.html"), "utf8");
const slotBody = `${slotShell}\n<script>\n${slotJs}\n</script>\n`;
await writeFile(join(dist, "slot-artifact.html"), slotBody);

const slotStandalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b0e12">
<title>Slot Racer</title>
</head>
<body>
${slotBody}</body>
</html>
`;
await writeFile(join(dist, "slot.html"), slotStandalone);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`js       ${kb(js)}`);
console.log(`index    ${kb(standalone)}  -> dist/index.html`);
console.log(`artifact ${kb(body)}  -> dist/artifact.html`);
console.log(`slot     ${kb(slotStandalone)}  -> dist/slot.html`);
console.log(`slot-art ${kb(slotBody)}  -> dist/slot-artifact.html`);
