# License Policy

All dependencies, assets, models, and third-party tools introduced into this project MUST pass a license audit.

## Acceptable Licenses (allowed-commercial)
- MIT
- Apache 2.0
- BSD (2-Clause, 3-Clause)
- ISC
- CC0 / Public Domain
- Zlib

## Blocked Licenses
The following licenses are strictly prohibited from being included in the build or source tree:
- CC BY-NC (and any other Non-Commercial variants)
- AGPL (Affero GPL)
- CC BY-ND (No Derivatives)

## Needs Review
- GPL/LGPL (Requires strict separation, e.g., invoked via CLI without linking, like FFmpeg)
- Custom proprietary licenses

## Guidelines
1. Do not commit or link any dependency without first verifying its license.
2. External tools (e.g., FFmpeg, Python sidecars) must be clearly separated and invoked via standard processes, ensuring their licenses do not infect the host application.
3. Keep an updated SBOM / NOTICE file when introducing new libraries.
