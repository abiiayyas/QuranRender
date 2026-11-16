# Contributing

Thanks for contributing to Quran Render. Start with
[`AGENTS.md`](AGENTS.md) (in Indonesian) — it maps the codebase and lists the
rules that must not be broken: clean-room, verbatim Quranic text, renderer
without Node access, database migration policy, bilingual UI, design tokens,
and changelog.

## Development

Prerequisites: macOS and Node.js 22+.

```bash
npm install
npm run dev          # app with hot reload
npm run typecheck    # must be clean
npm test             # Vitest, only src/shared/*.test.ts
npm run build
npm run lint:design  # qr-* classes and CSS tokens must be defined
npm run lint:a11y    # accessible names, labels, contrast tokens
```

Use separate test data while developing:

```bash
QR_USER_DATA=/tmp/qr-dev npm run dev
```

## Pull requests

- Keep changes small and focused.
- Run `npm run typecheck` and `npm test` before opening a PR; CI runs the same
  checks plus `lint:design` and `lint:a11y`.
- Follow the style of the surrounding code. Comments explain *why*, not *what*.
- Add a `CHANGELOG.md` entry for user-visible changes.
- Do not change Quranic text, and do not add living-creature imagery, music
  icons, or Arabic text as decoration (see `AGENTS.md`).

## Licenses

The project's own code is licensed under the [MIT License](LICENSE).
Third-party content and software keep their own licenses — see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and
[`content-manifest.json`](content-manifest.json).

By contributing, you agree to license your contributions under the project's
MIT license.
