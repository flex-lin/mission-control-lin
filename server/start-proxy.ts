#!/usr/bin/env ts-node
/**
 * Proxy startup script. Run directly with:
 *   npx ts-node server/start-proxy.ts
 * Or via package.json script:
 *   pnpm proxy
 */
import { startProxy } from "./proxy"

startProxy()
