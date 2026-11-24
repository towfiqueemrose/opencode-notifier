import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, "opencode")
  : join(HOME, ".config", "opencode")
const TELEGRAM_CONFIG = join(CONFIG_DIR, "telegram.json")
const DEBUG_LOG = join(CONFIG_DIR, "opencode-notifier-debug.log")
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const TOAST_SCRIPT = join(PLUGIN_DIR, "..", "assets", "show-task-toast.ps1")
const IS_WINDOWS = process.platform === "win32"
const POWERSHELL = "powershell.exe"
const LOCK_TTL_MS = 5000
const TELEGRAM_TIMEOUT_MS = 12000

type SoundName = "done" | "subagent_done" | "question" | "permission" | "error"

type TelegramSettings = {
  enabled?: boolean
  token?: string
  chat_id?: string | number
  bot_username?: string
}

type TelegramResponse<T> =
  | { ok: true; result: T }
  | { ok: false; status: number; description: string }

type TelegramChat = {
  id: number | string
  type?: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

type TelegramUpdate = {
  message?: { chat?: TelegramChat }
  edited_message?: { chat?: TelegramChat }
  channel_post?: { chat?: TelegramChat }
  edited_channel_post?: { chat?: TelegramChat }
}

type QuestionForm = {
  id?: string
  sessionID?: string
  title?: string
  metadata?: { kind?: string }
  fields?: Array<{ title?: string; description?: string }>
}

type PermissionAsk = {
  id?: string
  sessionID?: string
  action?: string
  resources?: string[]
  message?: string
}

const clean = (value: string, limit: number) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)

/**
 * Shows a native Windows toast. Callers normally fire and forget; the short
 * lived PowerShell process never blocks the TUI. Other platforms use
 * OpenCode's attention notification instead.
 */
function showTaskToast(
  title: string,
  message: string,
  onResult?: (result: { code: number | null; stdout: string; stderr: string; error?: string }) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        POWERSHELL,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", TOAST_SCRIPT],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, OPENCODE_ALERT_TITLE: title, OPENCODE_ALERT_MESSAGE: message },
        },
      )
      let stdout = ""
      let stderr = ""
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (code: number | null, error?: string) => {
        if (killTimer) clearTimeout(killTimer)
        onResult?.({ code, stdout: stdout.trim(), stderr: stderr.trim(), ...(error ? { error } : {}) })
        resolve(code === 0 && !error)
      }
      killTimer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // The process already exited.
        }
      }, 8000)
      killTimer.unref?.()
      child.stdout?.on("data", (chunk) => (stdout += String(chunk)))
      child.stderr?.on("data", (chunk) => (stderr += String(chunk)))
      child.once("error", (error) => finish(null, error.message))
      child.once("exit", (code) => finish(code))
    } catch (error) {
      onResult?.({
        code: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      })
      resolve(false)
    }
  })
}

export default Plugin.define({
  id: "opencode-notifier",
  setup(context) {
    const options = (context.options ?? {}) as {
      enabled?: boolean
      toast?: boolean
      sound?: boolean
      telegram?: boolean
      subagents?: boolean
      failures?: boolean
      questions?: boolean
      permissions?: boolean
      debug?: boolean
    }

    const debug = options.debug === true
    const log = (kind: string, data: unknown) => {
      if (!debug) return
      try {
        appendFileSync(DEBUG_LOG, JSON.stringify({ at: new Date().toISOString(), kind, data }) + "\n")
      } catch {
        // Never let diagnostics break the alert path.
      }
    }

    const readTelegramSettings = (): TelegramSettings | undefined => {
      try {
        return JSON.parse(readFileSync(TELEGRAM_CONFIG, "utf8")) as TelegramSettings
      } catch {
        return undefined
      }
    }

    const telegramApi = async <T>(
      token: string,
      method: string,
      payload?: Record<string, unknown>,
    ): Promise<TelegramResponse<T>> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
      timer.unref?.()
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload ?? {}),
          signal: controller.signal,
        })
        const data = (await response.json().catch(() => undefined)) as
          | { ok?: boolean; result?: T; description?: string }
          | undefined
        if (data?.ok === true) return { ok: true, result: data.result as T }
        return {
          ok: false,
          status: response.status,
          description: data?.description ?? `HTTP ${response.status}`,
        }
      } catch (error) {
        return {
          ok: false,
          status: 0,
          description: error instanceof Error ? error.message : String(error),
        }
      } finally {
        clearTimeout(timer)
      }
    }

    // Read the bot settings on each alert so edits apply without reloading.
    const sendTelegram = async (text: string): Promise<boolean> => {
      if (options.telegram === false) return false
      const settings = readTelegramSettings()
      const envToken = process.env.OPENCODE_TELEGRAM_TOKEN?.trim()
      const envChat = process.env.OPENCODE_TELEGRAM_CHAT_ID?.trim()
      if (settings?.enabled === false && !envToken) return false
      const token = envToken || settings?.token
      const chat = envChat || settings?.chat_id
      if (!token || !chat) return false

      const response = await telegramApi<{ message_id?: number }>(token, "sendMessage", {
        chat_id: chat,
        text,
        disable_web_page_preview: true,
      })
      log("telegram", {
        ok: response.ok,
        status: response.ok ? 200 : response.status,
        description: response.ok ? null : response.description,
      })
      return response.ok
    }

    const saveTelegramSettings = (token: string, chat: string | number, botUsername?: string) => {
      mkdirSync(CONFIG_DIR, { recursive: true })
      const temp = `${TELEGRAM_CONFIG}.${process.pid}.tmp`
      const payload: TelegramSettings = {
        enabled: true,
        token,
        chat_id: chat,
        ...(botUsername ? { bot_username: botUsername } : {}),
      }
      writeFileSync(temp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 })
      renameSync(temp, TELEGRAM_CONFIG)
      try {
        chmodSync(TELEGRAM_CONFIG, 0o600)
      } catch {
        // chmod is best effort on platforms that do not support it.
      }
      if (IS_WINDOWS) {
        try {
          const user =
            process.env.USERDOMAIN && process.env.USERNAME
              ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
              : process.env.USERNAME
          if (user) {
            const child = spawn(
              "icacls",
              [TELEGRAM_CONFIG, "/inheritance:r", "/grant:r", `${user}:(R,W)`],
              { windowsHide: true, stdio: "ignore" },
            )
            child.on("error", () => {})
          }
        } catch {
          // The file still sits under the user profile.
        }
      }
    }

    // Several TUI windows can be connected to the same server. Claim the
    // alert for one of them so a single event does not play N times.
    const claimAlert = (key: string) => {
      const lock = `${CONFIG_DIR}/opencode-notifier-${key}.lock`
      const release = () => {
        const timer = setTimeout(() => {
          try {
            unlinkSync(lock)
          } catch {
            // The lock may already be gone.
          }
        }, LOCK_TTL_MS)
        timer.unref?.()
      }
      try {
        const fd = openSync(lock, "wx")
        writeFileSync(fd, String(Date.now()))
        closeSync(fd)
        release()
        return true
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_TTL_MS) {
            writeFileSync(lock, String(Date.now()))
            release()
            return true
          }
        } catch {
          // Race with another instance; treat as already claimed.
        }
        return false
      }
    }

    log("setup", { version: context.app.version })

    if (options.enabled === false) return

    const showToast = options.toast !== false
    const playSound = options.sound !== false
    const notifySubagents = options.subagents === true
    const reportFailures = options.failures !== false
    const notifyQuestions = options.questions !== false
    const notifyPermissions = options.permissions !== false
    const recent = new Map<string, number>()

    const canNotify = (sessionID: string) => {
      const last = recent.get(sessionID) ?? 0
      const now = Date.now()
      // Guard against duplicate finish events for the same run.
      if (now - last < 1500) return false
      recent.set(sessionID, now)
      return true
    }

    // Requests replay when a TUI reconnects. Keep a short-lived memory of
    // handled request IDs so one question or approval alerts only once.
    const seenRequests = new Map<string, number>()
    const markRequest = (id: string) => {
      const now = Date.now()
      for (const [key, at] of seenRequests) {
        if (now - at > 10 * 60_000) seenRequests.delete(key)
      }
      if (seenRequests.has(id)) return false
      seenRequests.set(id, now)
      return true
    }

    const sessionLabel = (sessionID: string, fallback: string) => {
      const session = context.data.session.get(sessionID)
      return clean(session?.title ?? "", 180) || fallback
    }

    const projectName = () => clean(basename(context.location?.directory ?? ""), 80) || "OpenCode"
    const timeLabel = () => new Date().toLocaleString()

    /**
     * Toast + chime. Windows uses the bundled PowerShell toast; everything
     * else lets OpenCode raise the system notification.
     */
    const notifyAlert = async (title: string, message: string, sound: SoundName) => {
      if (IS_WINDOWS && existsSync(TOAST_SCRIPT)) {
        if (showToast) {
          log("toast", { title, message })
          void showTaskToast(title, message, (result) => log("toast-result", result))
        }
        if (playSound) {
          await context.attention.notify({
            title,
            message,
            notification: false,
            sound: { name: sound, when: "always" },
          })
        }
        return
      }

      if (!showToast && !playSound) return
      await context.attention.notify({
        title,
        message,
        notification: showToast ? { when: "always" } : false,
        sound: playSound ? { name: sound, when: "always" } : false,
      })
    }

    const notifySound = async (title: string, message: string, sound: SoundName) => {
      if (!playSound) return
      await context.attention.notify({
        title,
        message,
        notification: false,
        sound: { name: sound, when: "always" },
      })
    }

    const alertDone = async (sessionID: string, interrupted = false) => {
      log("done-event", { sessionID, interrupted })
      if (!canNotify(sessionID)) return

      const session = context.data.session.get(sessionID)
      const message = sessionLabel(sessionID, interrupted ? "Agent was interrupted" : "Agent finished")
      log("done-session", { sessionID, parentID: session?.parentID ?? null, message })

      if (session?.parentID) {
        if (!notifySubagents || !playSound) return
        if (!claimAlert(sessionID)) return
        await notifySound("OpenCode Subagent Completed", message, "subagent_done")
        return
      }

      if (!claimAlert(sessionID)) {
        log("claimed-elsewhere", { sessionID })
        return
      }

      const title = interrupted ? "OpenCode Task Interrupted" : "OpenCode Task Completed"
      await notifyAlert(title, message, "done")
      void sendTelegram(
        `${interrupted ? "⏹" : "✅"} ${title}\n\nTask: ${message}\nProject: ${projectName()}\nTime: ${timeLabel()}`,
      )
    }

    const alertFailed = async (sessionID: string, errorMessage: string) => {
      if (!reportFailures || !canNotify(sessionID)) return

      const session = context.data.session.get(sessionID)
      if (session?.parentID) return

      const task = sessionLabel(sessionID, "Agent")
      const message = clean(errorMessage, 200) || task
      if (!claimAlert(sessionID)) {
        log("claimed-elsewhere", { sessionID })
        return
      }
      await notifyAlert("OpenCode Task Failed", message, "error")
      void sendTelegram(
        `❌ OpenCode Task Failed\n\nTask: ${task}\nError: ${message}\nProject: ${projectName()}\nTime: ${timeLabel()}`,
      )
    }

    const alertQuestion = async (form: QuestionForm) => {
      if (!notifyQuestions) return
      const kind = (form.metadata as { kind?: string } | undefined)?.kind
      if (kind !== "question") return
      const id = form.id
      const sessionID = form.sessionID
      if (!id || !sessionID) return
      if (!markRequest(id)) return
      if (!claimAlert(id)) {
        log("claimed-elsewhere", { id })
        return
      }

      const session = context.data.session.get(sessionID)
      const task = `${sessionLabel(sessionID, "Agent")}${session?.parentID ? " (subagent)" : ""}`
      const fields = form.fields ?? []
      const first = fields[0]
      const heading = clean(first?.title ?? form.title ?? "Question", 80) || "Question"
      const detail = clean(first?.description ?? "", 200)
      const extra = fields.length > 1 ? ` (+${fields.length - 1} more)` : ""
      const title = "OpenCode Question"
      const message = clean(`${heading}${detail ? `: ${detail}` : ""}${extra}`, 220)

      await notifyAlert(title, message, "question")
      void sendTelegram(
        `❓ ${title}\n\nTask: ${task}\nQuestion: ${heading}${detail ? `\n${detail}` : ""}${extra}\nProject: ${projectName()}\nTime: ${timeLabel()}`,
      )
    }

    const alertPermission = async (request: PermissionAsk) => {
      if (!notifyPermissions) return
      const id = request.id
      const sessionID = request.sessionID
      if (!id || !sessionID) return
      if (!markRequest(id)) return
      if (!claimAlert(id)) {
        log("claimed-elsewhere", { id })
        return
      }

      const session = context.data.session.get(sessionID)
      const task = `${sessionLabel(sessionID, "Agent")}${session?.parentID ? " (subagent)" : ""}`
      const action = clean(request.action ?? "permission", 40) || "permission"
      const resources = (request.resources ?? []).filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
      const shown = resources.slice(0, 3).map((item) => clean(item, 160))
      const resource = shown.join(", ") || "*"
      const extra = resources.length > shown.length ? ` (+${resources.length - shown.length} more)` : ""
      const note = clean(request.message ?? "", 200)
      const title = "OpenCode Permission Required"
      const message = clean(`${action}: ${resource}${extra}${note ? ` — ${note}` : ""}`, 220)

      await notifyAlert(title, message, "permission")
      void sendTelegram(
        `🔐 ${title}\n\nTask: ${task}\nAction: ${action}\nResource: ${resource}${extra}${note ? `\nNote: ${note}` : ""}\nProject: ${projectName()}\nTime: ${timeLabel()}`,
      )
    }

    const collectChats = (updates: TelegramUpdate[]) => {
      const seen = new Map<string, { id: string; title: string; type: string }>()
      for (const update of updates) {
        const message =
          update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post
        const chat = message?.chat
        if (!chat?.id) continue
        const id = String(chat.id)
        if (seen.has(id)) continue
        const name =
          chat.title ??
          [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
          chat.username ??
          id
        seen.set(id, {
          id,
          title: `${name || id} (${chat.type ?? "chat"})`,
          type: chat.type ?? "chat",
        })
      }
      return [...seen.values()]
    }

    const setupTelegram = async () => {
      const existing = readTelegramSettings()
      if (existing?.token && existing?.chat_id) {
        const reconfigure = await context.ui.dialog.confirm({
          title: "Telegram alerts",
          message: `Telegram is already configured${existing.bot_username ? ` for @${existing.bot_username}` : ""}. Reconfigure it?`,
          label: { confirm: "Reconfigure", cancel: "Keep current" },
        })
        if (!reconfigure) {
          context.ui.toast.show({ title: "Telegram alerts", message: "Existing configuration kept.", variant: "success" })
          return
        }
      }

      await context.ui.dialog.alert({
        title: "Create a Telegram bot",
        message:
          "Open @BotFather in Telegram, send /newbot, choose a name and username, then copy the bot token.\n\nOnly paste a token for a bot you own. The token is stored on this machine and is never shared.",
      })

      const entered = await context.ui.dialog.prompt({
        title: "Telegram bot token",
        placeholder: "123456789:AA...",
      })
      const token = entered?.trim()
      if (!token) return
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
        await context.ui.dialog.alert({
          title: "Invalid token",
          message: "That does not look like a Telegram bot token. Copy it again from @BotFather.",
        })
        return
      }

      const me = await telegramApi<{ id: number; username?: string; first_name?: string }>(token, "getMe")
      if (!me.ok) {
        await context.ui.dialog.alert({
          title: "Token rejected",
          message: me.description || "Telegram rejected that token.",
        })
        return
      }
      const username = me.result.username
      log("setup-telegram", { bot: username ?? null })

      const link = username ? `https://t.me/${username}` : "your bot chat"
      await context.ui.dialog.alert({
        title: "Start the bot",
        message: `Open ${link} in Telegram and press Start.\n\nThen return here and choose Check again.`,
      })

      let chat: string | undefined
      let manual = false

      for (let attempt = 0; attempt < 5 && chat === undefined && !manual; attempt++) {
        const updates = await telegramApi<TelegramUpdate[]>(token, "getUpdates", {
          limit: 100,
          timeout: 0,
          allowed_updates: ["message", "channel_post"],
        })

        if (!updates.ok) {
          if (updates.status === 409) {
            await context.ui.dialog.alert({
              title: "Webhook active",
              message:
                "This bot has a webhook, so chat detection cannot read updates. Enter the chat ID manually. You can get it from @userinfobot in Telegram.",
            })
            manual = true
            break
          }
          const retry = await context.ui.dialog.confirm({
            title: "Could not read updates",
            message: `${updates.description}\n\nCheck the bot, then try again or enter the chat ID manually.`,
            label: { confirm: "Check again", cancel: "Enter chat ID manually" },
          })
          if (!retry) {
            manual = true
            break
          }
          continue
        }

        const chats = collectChats(updates.result)
        if (chats.length === 0) {
          const retry = await context.ui.dialog.confirm({
            title: "No chat found",
            message: `Open ${link} and press Start, then choose Check again.`,
            label: { confirm: "Check again", cancel: "Enter chat ID manually" },
          })
          if (!retry) {
            manual = true
            break
          }
          continue
        }

        if (chats.length === 1) {
          const use = await context.ui.dialog.confirm({
            title: "Use this chat?",
            message: `${chats[0].title}\nID: ${chats[0].id}`,
            label: { confirm: "Use chat", cancel: "Choose another" },
          })
          if (use) chat = chats[0].id
          else manual = true
          break
        }

        const choice = await context.ui.dialog.select<string>({
          title: "Choose a Telegram chat",
          options: chats.map((item) => ({
            title: item.title,
            value: item.id,
            description: `ID: ${item.id}`,
          })),
        })
        if (choice === undefined) {
          manual = true
          break
        }
        chat = choice
      }

      if (chat === undefined && manual) {
        const enteredChat = await context.ui.dialog.prompt({
          title: "Telegram chat ID",
          placeholder: "123456789",
        })
        const value = enteredChat?.trim()
        if (!value) return
        chat = value
      }

      if (chat === undefined) {
        await context.ui.dialog.alert({
          title: "No chat selected",
          message: "Setup cancelled. Run /task-alert-setup again when you are ready.",
        })
        return
      }

      const test = await telegramApi<{ message_id: number }>(token, "sendMessage", {
        chat_id: chat,
        text: "✅ OpenCode Notifier is connected.\n\nYou will get alerts for completed tasks, questions, and permission requests.",
        disable_web_page_preview: true,
      })
      if (!test.ok) {
        await context.ui.dialog.alert({
          title: "Test message failed",
          message: `${test.description}\n\nIf Telegram says "chat not found", open the bot and press Start, then run setup again.`,
        })
        return
      }

      saveTelegramSettings(token, chat, username)
      context.ui.toast.show({
        title: "OpenCode Notifier",
        message: `Telegram connected${username ? ` to @${username}` : ""}. Try /task-alert-test.`,
        variant: "success",
      })
    }

    const stopSucceeded = context.data.on("session.execution.succeeded", (event) => {
      log("event", { type: "succeeded", sessionID: event.data.sessionID })
      void alertDone(event.data.sessionID)
    })

    const stopInterrupted = context.data.on("session.execution.interrupted", (event) => {
      log("event", { type: "interrupted", sessionID: event.data.sessionID })
      void alertDone(event.data.sessionID, true)
    })

    const stopFailed = context.data.on("session.execution.failed", (event) => {
      log("event", { type: "failed", sessionID: event.data.sessionID })
      const error = event.data.error
      const message = error && "message" in error && typeof error.message === "string" ? error.message : ""
      void alertFailed(event.data.sessionID, message)
    })

    const stopQuestion = context.data.on("form.created", (event) => {
      const form = event.data.form as unknown as QuestionForm
      log("event", { type: "form.created", id: form?.id, sessionID: form?.sessionID })
      void alertQuestion(form)
    })

    const stopPermission = context.data.on("permission.asked", (event) => {
      const request = event.data as unknown as PermissionAsk
      log("event", { type: "permission.asked", id: request?.id, sessionID: request?.sessionID })
      void alertPermission(request)
    })

    context.keymap.layer(() => ({
      commands: [
        {
          id: "opencode-notifier.setup",
          title: "Set up Telegram alerts",
          group: "Notifier",
          slash: { name: "task-alert-setup", aliases: ["notifier-setup"] },
          run: async () => {
            try {
              await setupTelegram()
            } catch (error) {
              log("setup-error", {
                message: error instanceof Error ? error.message : String(error),
              })
              context.ui.toast.show({
                title: "OpenCode Notifier",
                message: "Setup failed. Check the notifier log and try again.",
                variant: "warning",
              })
            }
          },
        },
        {
          id: "opencode-notifier.test",
          title: "Test task alerts",
          group: "Notifier",
          slash: { name: "task-alert-test", aliases: ["notifier-test"] },
          run: async () => {
            const message = "Test alert: audio, desktop notification, and Telegram"
            let toast = false
            let sound = false

            if (IS_WINDOWS && existsSync(TOAST_SCRIPT)) {
              if (showToast) {
                toast = await showTaskToast("OpenCode Task Completed", message, (result) =>
                  log("toast-result", result),
                )
              }
              if (playSound) {
                const result = await context.attention.notify({
                  title: "OpenCode Task Completed",
                  message,
                  notification: false,
                  sound: { name: "done", when: "always" },
                })
                sound = result.sound
              }
            } else {
              const result = await context.attention.notify({
                title: "OpenCode Task Completed",
                message,
                notification: showToast ? { when: "always" } : false,
                sound: playSound ? { name: "done", when: "always" } : false,
              })
              toast = result.notification
              sound = result.sound
            }

            const telegram = await sendTelegram(
              `🧪 OpenCode notifier test\n\nDesktop toast, chime, and Telegram delivery are connected.\nProject: ${projectName()}\nTime: ${timeLabel()}`,
            )
            const ok = (showToast ? toast : true) && (playSound ? sound : true) && telegram
            context.ui.toast.show({
              title: "OpenCode Notifier",
              message: `toast: ${showToast ? (toast ? "sent" : "failed") : "disabled"}, sound: ${
                playSound ? (sound ? "played" : "failed") : "disabled"
              }, telegram: ${telegram ? "sent" : "failed/disabled"}`,
              variant: ok ? "success" : "warning",
            })
          },
        },
      ],
    }))

    return () => {
      stopSucceeded()
      stopInterrupted()
      stopFailed()
      stopQuestion()
      stopPermission()
    }
  },
})
