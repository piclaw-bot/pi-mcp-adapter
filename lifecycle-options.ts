import type { McpAdapterOptions } from "./types.ts";

/** Preserve standalone eager startup unless an SDK host owns session startup. */
export function shouldInitializeMcpOnLoad(
  options: Pick<McpAdapterOptions, "initializeOnLoad">,
): boolean {
  return options.initializeOnLoad !== false;
}
