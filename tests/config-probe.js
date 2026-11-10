/** Prints the resolved configuration, so a test can see what the flags did. */
import { config } from '../src/lib/config.js';
process.stdout.write(JSON.stringify(config));
