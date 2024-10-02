/// <reference types="node" />

const { build } = require("esbuild");
const { peerDependencies } = require("../package.json");

(async () => {
  const shared = {
    entryPoints: ["src/index.ts"],
    platform: "browser",
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ["es2022"],
    external: Object.keys(peerDependencies || {}),
    legalComments: "none",
  };

  await build({
    ...shared,
    format: "cjs",
    outfile: "dist/index.cjs.js",
  });

  await build({
    ...shared,
    outfile: "dist/index.esm.js",
    format: "esm",
  });

  console.log(`Build complete`);
})();
