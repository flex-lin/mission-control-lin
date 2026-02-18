#!/usr/bin/env ts-node
/**
 * Standalone queue worker startup script.
 * Normally the worker runs embedded in Next.js (via instrumentation.ts).
 * Use this for running it standalone:
 *   pnpm queue
 */
import { startQueueWorker } from "./queue-worker"

startQueueWorker()
