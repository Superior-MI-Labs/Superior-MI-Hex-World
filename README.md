# Superior MI Hex World

Independent, game-neutral sparse hex world engine. [Live laboratory](https://superior-mi-labs.github.io/Superior-MI-Hex-World/).

First foundation: signed axial Q/R plus vertical Z, configurable physical scale and chunk dimensions, sparse known chunks, partial geometry, independent simulation and animation clocks, configurable effect lifetimes, provider boundary. The browser laboratory is debug artwork, not production Atlas rendering.

Run `node --test tests/core.test.mjs` (Node 20+). Serve the root with `python3 -m http.server 8000` and open localhost:8000. See [architecture](docs/ARCHITECTURE.md).