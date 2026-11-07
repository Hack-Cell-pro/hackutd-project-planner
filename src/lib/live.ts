// TEMPORARY for local verification: use the stand-in engine.
export * from "./engine";
import { join as joinSync } from "./engine";
export const join = (name: string) => Promise.resolve(joinSync(name));
