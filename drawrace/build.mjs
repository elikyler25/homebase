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

const result = await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020", "safari15"],
  minify,
  write: false,
  legalComments: "none",
});

const js = result.outputFiles[0].text;
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

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`js       ${kb(js)}`);
console.log(`index    ${kb(standalone)}  -> dist/index.html`);
console.log(`artifact ${kb(body)}  -> dist/artifact.html`);
