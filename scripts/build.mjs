import { readFile, rm, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const shouldObfuscate = process.argv.includes("--obfuscate");

const jsEntries = {
  background: path.join(rootDir, "background.js"),
  content: path.join(rootDir, "content.js"),
  popup: path.join(rootDir, "src/popup/main.jsx"),
  options: path.join(rootDir, "src/options/main.jsx")
};

async function copyStaticAssets() {
  await cp(publicDir, distDir, { recursive: true, force: true });
}

async function obfuscateBuiltFiles() {
  const targets = ["background.js", "content.js", "popup.js", "options.js"];
  for (const fileName of targets) {
    const filePath = path.join(distDir, fileName);
    const source = await readFile(filePath, "utf8");
    const result = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: true,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: true,
      identifierNamesGenerator: "hexadecimal",
      renameGlobals: false,
      rotateStringArray: true,
      selfDefending: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      stringArray: true,
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false
    });
    await writeFile(filePath, result.getObfuscatedCode(), "utf8");
  }
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await build({
    entryPoints: jsEntries,
    outdir: distDir,
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    target: ["chrome120"],
    legalComments: "none"
  });

  await copyStaticAssets();

  if (shouldObfuscate) {
    await obfuscateBuiltFiles();
    console.log("Build complete: dist/ (minified + obfuscated)");
    return;
  }

  console.log("Build complete: dist/ (minified)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
