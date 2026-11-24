import { Plugin } from "@opencode/plugin"

/**
 * Server-side placeholder. It intentionally does nothing; it exists so the
 * package can be installed with `opencode plugin add` and the TUI part loads
 * alongside it.
 */
export default Plugin.define({
  id: "opencode-notifier",
  setup() {},
})
