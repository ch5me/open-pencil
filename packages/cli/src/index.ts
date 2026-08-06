#!/usr/bin/env bun
import { prepareImplementationProvenance } from "./implementation-provenance";

await prepareImplementationProvenance(process.argv);
await import("./main");
