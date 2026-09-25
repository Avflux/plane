/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Usage: npx tsx packages/i18n/scripts/generate-locale-loaders.ts
// Reads: src/locales/<locale>/*.json
// Writes: src/core/locale-loaders.generated.ts
//
// Why a generated map of literal `import()` calls instead of a single
// `import(`../locales/${language}/${namespace}.json`)`:
//
// A template-literal specifier is opaque to the bundler, so it survives into
// dist/index.js untouched and is resolved by the *runtime*, relative to the
// built entry -- i.e. against packages/i18n/locales. That path only ever
// existed because packages/i18n/locales is a symlink to src/locales, and a
// Windows checkout without symlink support (core.symlinks=false) materialises
// that symlink as a one-line text file. Every translation then failed to load
// and the UI rendered raw keys.
//
// Literal specifiers are resolved at build time, so the bundler emits one chunk
// per locale/namespace next to dist/index.js and the built package is
// self-contained on every OS. Lazy loading is preserved: nothing is fetched
// until a language/namespace is actually requested.

import fs from "node:fs";
import path from "node:path";
import { LOCALES_DIR, listLocales } from "./lib/locale-io.js";

const COPYRIGHT_HEADER = `/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */`;

/** Locale and namespace names are inlined as object keys and import paths. */
function assertSafeName(name: string, kind: string): void {
  if (!/^[A-Za-z0-9-]+$/.test(name)) {
    console.error(`Error: Unsupported ${kind} name "${name}" (expected [A-Za-z0-9-])`);
    process.exit(1);
  }
}

function main(): void {
  const rootDir = import.meta.dirname;
  const outputFile = path.resolve(rootDir, "..", "src", "core", "locale-loaders.generated.ts");

  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`Error: Locales directory not found: ${LOCALES_DIR}`);
    process.exit(1);
  }

  const locales = listLocales();
  if (locales.length === 0) {
    console.error(`Error: No locale directories found in ${LOCALES_DIR}`);
    process.exit(1);
  }

  const blocks: string[] = [];
  let namespaceCount = 0;

  for (const locale of locales) {
    assertSafeName(locale, "locale");

    const localeDir = path.join(LOCALES_DIR, locale);
    const namespaces = fs
      .readdirSync(localeDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.basename(file, ".json"))
      .toSorted();

    if (namespaces.length === 0) {
      console.error(`Error: No namespace files found in ${localeDir}`);
      process.exit(1);
    }

    const entries = namespaces.map((namespace) => {
      assertSafeName(namespace, "namespace");
      return `    "${namespace}": () => import("../locales/${locale}/${namespace}.json"),`;
    });

    namespaceCount += namespaces.length;
    blocks.push(`  "${locale}": {\n${entries.join("\n")}\n  },`);
  }

  const output = `${COPYRIGHT_HEADER}

// AUTO-GENERATED — DO NOT EDIT
// Generated from ${locales.length} locales (${namespaceCount} namespace files)
// Run: pnpm run generate:loaders

type TLocaleLoader = () => Promise<{ default: Record<string, unknown> }>;

export const LOCALE_LOADERS: Record<string, Record<string, TLocaleLoader>> = {
${blocks.join("\n")}
};
`;

  // Write atomically: `pnpm dev` (tsdown --watch) and `pnpm build` can run in
  // the same package concurrently, and a reader must never observe a
  // half-written module.
  const tempFile = `${outputFile}.tmp`;
  fs.writeFileSync(tempFile, output, "utf-8");
  fs.renameSync(tempFile, outputFile);

  console.log(`Generated loaders for ${locales.length} locales from ${namespaceCount} namespace files`);
}

main();
