# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev:start          # Start dev server at localhost:3000 (auto-generates multisrc + index)

# Build
npm run build:full         # Full build: clean, generate multisrc, compile TS, create manifest
npm run build:multisrc     # Only regenerate multisrc plugins
npm run build:compile      # Only run TypeScript compilation
npm run build:manifest     # Only rebuild plugins.json manifest

# Code quality
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
npm run format             # Prettier format
npm run format:check       # Prettier validation check

# Utilities
npm run check:sites        # Validate plugin site URLs
npm run serve:dev          # Build and serve for mobile emulator testing
```

## Architecture

### Plugin Types

**1. Single Plugins** — individual `.ts` files in `plugins/<language>/`

Each implements the `Plugin.PluginBase` interface:
```typescript
{
  id, name, icon, site, version,
  popularNovels(page, options),
  parseNovel(novelPath),
  parseChapter(chapterPath),
  searchNovels(term, page),
  // optional: filters, resolveUrl, imageRequestInit, pluginSettings
}
```

**2. Multisrc Plugins** — template-based generation under `plugins/multisrc/<templateName>/`

Each multisrc entry contains:
- `template.ts` — abstract base class with shared scraping logic
- `sources.json` — array of site definitions (id, URL, language, options)
- `generator.js` — reads sources + template, writes generated plugins to `plugins/<lang>/<Name>multisrc.ts`
- `filters/` — optional per-source filter definitions (`<id>.json`)

Available templates: `madara` (largest, WordPress Madara theme), `lightnovelwp`, `readnovelfull`, `readwn`, `fictioneer`, `hotnovelpub`, `mtlnovel`, `lightnovelworld`, `ranobes`, `novelcool`, `rulate`, `ifreedom`.

### Build Pipeline

1. `plugins/multisrc/generate-multisrc-plugins.js` invokes each `generator.js` → writes `*multisrc.ts` files
2. `scripts/generate-plugin-index.js` scans all language folders → writes `plugins/index.ts`
3. `tsc --project tsconfig.production.json` compiles TypeScript
4. `scripts/build-plugin-manifest.js` creates `.dist/plugins.json` and `.dist/plugins.min.json`

CI publishes to the `plugins` branch on every push to `master` that touches `plugins/`.

### Key Libraries

- `@libs/fetch` — HTTP fetch with proxy support (use instead of raw `fetch`)
- `@libs/storage` — localStorage/sessionStorage abstraction
- `@libs/filterInputs` — exports `FilterTypes` enum and filter constructors
- `@libs/novelStatus` — novel status string constants
- `cheerio` — HTML parsing (jQuery-like API)

### Filter Types (`src/types/filters.ts`)

`FilterTypes.TextInput`, `FilterTypes.Picker`, `FilterTypes.CheckboxGroup`, `FilterTypes.Switch`, `FilterTypes.ExcludableCheckboxGroup`

### Testing Interface

The Vite dev server (`npm run dev:start`) serves a React UI at `localhost:3000` for manually testing all plugin methods (popularNovels, searchNovels, parseNovel, parseChapter) with a built-in proxy to handle CORS.

### Icons

Plugin icons go in `public/static/` and should be 96×96px. Source files in `icons/src/`.

### BLACKLIST.json

Tracks plugins removed from the repo (DMCA/takedowns). Do not re-add listed sites.
