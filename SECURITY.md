# Security policy

Kuartz Depth runs entirely in the browser: images are processed locally and never sent to a server. The tool itself only downloads ONNX Runtime Web (jsDelivr) and the model weights (Hugging Face). The hosted version also loads Google Tag Manager for audience measurement; Google Analytics cookies are only set after consent.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub's vulnerability reporting](https://github.com/Kuartz-studio/tool-depthmap-generator/security/advisories/new) instead, with steps to reproduce and the affected browser.

## Scope

- In scope: the web app and the engine code in this repository, and the deployed site at https://tool-depthmap-generator.vercel.app.
- Out of scope: ONNX Runtime Web and the models themselves. Please report those to their upstream projects.
