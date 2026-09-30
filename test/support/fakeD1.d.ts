// Types for fakeD1.js: it behaves as a D1Database, so tests pass it wherever Env.DB goes.
import type { Env } from "../../src/worker/env";

export function createFakeD1(): D1Database;
export function testEnv(overrides?: Partial<Env>): Env;
