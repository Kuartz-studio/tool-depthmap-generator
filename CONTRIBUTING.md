# Contributing to Kuartz Depth

Thanks for helping. This guide takes you from a fresh clone to a pull request. Issues and pull requests can be written in English or French.

## Setup

You need Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000. A Chromium-based browser exercises the WebGPU path; add `?device=wasm` to the URL to test the CPU path.

## Where things live

| Path | What it does |
| --- | --- |
| `public/engine/core.js` | Pure image kernels (resizing, filters, depth processing, PNG and ZIP encoders) and the Web Worker protocol. It runs on the main thread, in the worker and in the Node tests, so keep it free of dependencies and DOM access. |
| `public/engine/app.js` | UI state, ONNX Runtime, the WebGL preview, import and export. |
| `components/depth-tool.tsx` | The tool markup. Its ids, classes and `data-*` attributes are the contract with `app.js`: change both together. |
| `components/guide.tsx`, `lib/faq.ts` | The indexable guide and FAQ. The FAQ is mirrored in the JSON-LD, so edit it in `lib/faq.ts` only. |
| `app/globals.css` | All styles. Design tokens (colors, fonts) are at the top, with a dark theme. |

## Before you open a pull request

```bash
npm test           # engine unit tests
npm run typecheck  # TypeScript
npm run build      # production build
```

Then check the tool in a browser: import an image, generate a depth map, look at the Relief 3D preview and export a PNG.

## Guidelines

- **Private by design.** User images must never leave the browser: no uploads, no analytics on image content.
- **Small, focused pull requests.** Explain the why, and add before/after screenshots for UI changes.
- **Consistent copy.** The interface is in French for now and speaks to the user informally ("tu"). An English version is very welcome; open an issue first so we can agree on the approach.
- **Commit messages.** Imperative mood and a short subject line, such as "Add Depth Anything 3 Large".

## Adding a model

Models are declared in the `MODELS` object at the top of `public/engine/app.js`: Hugging Face repository, output kind (`disparity` or `depth`), input size (a multiple of 14), how that size applies (`short` or `long` side) and the files for each precision, with their sizes. Only propose models whose license allows the use you describe, and state that license in the entry.

## Reporting bugs

Use the [bug report form](https://github.com/Kuartz-studio/tool-depthmap-generator/issues/new?template=bug_report.yml). Include your browser, OS and GPU, and the text of the engine chip in the top right corner of the tool. For security issues, see [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
