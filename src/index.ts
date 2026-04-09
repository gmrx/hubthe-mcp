#!/usr/bin/env node

import "./tools/read.js";
import "./tools/write.js";
import { startTransport } from "./transport.js";

startTransport().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
