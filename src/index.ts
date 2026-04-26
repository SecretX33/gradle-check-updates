#!/usr/bin/env node

import { parseArgs } from "./cli/args";
import { run } from "./cli/run";

const parseResult = parseArgs();
if (!parseResult.ok) {
  console.error(`gcu: ${parseResult.error}`);
  process.exit(2);
}

const exitCode = await run(parseResult.args);
process.exit(exitCode);
