#!/usr/bin/env node

import App from "#lib/app";

const app = new App();

await app.cli();

app.run();
