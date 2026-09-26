/** The Entry wrapper `tc init` registers on this platform. POSIX hosts run the
 * bash wrapper; Windows hosts have no bash, so they run the shell-free Node
 * gate instead. Both wrappers are always written, so only the registered
 * command differs. */
export function entryWrapperName(): "entry.sh" | "entry.mjs" {
  return process.platform === "win32" ? "entry.mjs" : "entry.sh";
}
