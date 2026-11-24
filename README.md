# OpenCode Notifier

Desktop notifications, attention chimes, and Telegram messages for
[OpenCode](https://opencode.ai) 2.4+.

Get a toast, a chime, and a Telegram message when:

| Event | Toast | Chime | Telegram |
| --- | --- | --- | --- |
| A task completes | `OpenCode Task Completed` | `done` | ✅ |
| A task is interrupted | `OpenCode Task Interrupted` | `done` | ⏹ |
| A task fails | `OpenCode Task Failed` | `error` | ❌ |
| The `question` tool asks you something | `OpenCode Question` | `question` | ❓ |
| A permission request needs approval | `OpenCode Permission Required` | `permission` | 🔐 |

Only one of several open TUI windows claims an alert, so you do not get
duplicate chimes or Telegram messages.

## Requirements

- OpenCode 2.4 or newer.
- A terminal client (the plugin extends the TUI). Headless runs do not alert.
- A Telegram account if you want Telegram delivery.

## Install

### From GitHub (one command)

```sh
opencode plugin add github:towfiqueemrose/opencode-notifier
```

Restart OpenCode if the plugin does not appear immediately, then run
`/task-alert-setup` inside the TUI.

### From the zip

Windows:

```powershell
Expand-Archive opencode-notifier.zip -DestinationPath .
cd opencode-notifier
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux:

```sh
unzip opencode-notifier.zip
cd opencode-notifier
./install.sh
```

The installer copies the plugin to
`~/.config/opencode/plugins/opencode-notifier`, where OpenCode discovers it
automatically. Restart OpenCode, then run `/task-alert-setup`.

Use one install method. Installing the GitHub package and then running the zip
installer creates two copies of the same plugin.

The shared package uses OpenCode's built-in chimes. If you already override
`attention.sounds` in `cli.json`, your overrides are respected.

## Set up Telegram

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Choose a name and a username ending in `bot`.
3. Copy the bot token.
4. In OpenCode, run:

   ```text
   /task-alert-setup
   ```

5. Paste the token. The wizard validates it and shows the bot username.
6. Open `https://t.me/<botusername>` and press **Start**.
7. Choose **Check again** in the wizard. It finds your chat automatically.
8. The wizard sends a test message and saves the credentials.

If the bot has a webhook, automatic chat detection is blocked. The wizard asks
for the chat ID instead; get it from **@userinfobot**.

Test the whole path with:

```text
/task-alert-test
```

## Credentials

Credentials are stored in `~/.config/opencode/telegram.json`:

```json
{
  "enabled": true,
  "token": "123456789:AA...",
  "chat_id": "123456789",
  "bot_username": "my_notifier_bot"
}
```

Environment variables override the file:

```sh
OPENCODE_TELEGRAM_TOKEN=123456789:AA...
OPENCODE_TELEGRAM_CHAT_ID=123456789
```

On Windows the setup wizard restricts the file ACL to the current user. On
macOS and Linux it writes mode `0600`.

**Never commit or share `telegram.json` or the bot token.** A token gives full
control of the bot. Each person should create their own bot.

## Configuration

The plugin works without editing `opencode.json(c)` or `cli.json`. Defaults:

| Option | Default | Effect |
| --- | --- | --- |
| `toast` | `true` | Desktop notification |
| `sound` | `true` | Attention chime |
| `telegram` | `true` | Telegram delivery |
| `questions` | `true` | Alert on `question` forms |
| `permissions` | `true` | Alert on permission requests |
| `subagents` | `false` | Chime when a subagent finishes |
| `failures` | `true` | Alert on failed runs |
| `debug` | `false` | Write `opencode-notifier-debug.log` |

To pass options, configure the package in `opencode.json(c)`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-notifier",
      "options": { "subagents": true, "debug": true }
    }
  ]
}
```

### Sounds

The plugin uses these built-in sound names: `done`, `subagent_done`,
`question`, `permission`, `error`. Override any of them in `cli.json`:

```jsonc
{
  "attention": {
    "sounds": {
      "question": "C:/Users/me/sounds/question.wav",
      "permission": "C:/Users/me/sounds/permission.wav"
    }
  }
}
```

### Disable

```sh
opencode plugin remove opencode-notifier
```

Or add `"-opencode-notifier"` to the `plugins` array in your global
`opencode.json(c)`.

## Troubleshooting

- **Telegram says `chat not found`:** open the bot and press Start, then run
  `/task-alert-setup` again.
- **No Telegram messages at all:** check `telegram.json` exists and
  `enabled` is `true`; run `/task-alert-test`. If you use environment
  variables, confirm they are visible to the OpenCode process.
- **No toast:** on Windows the toast comes from PowerShell, so Windows may
  attribute it to **Windows PowerShell**. Check Focus Assist and notification
  settings. On macOS/Linux the toast uses OpenCode's system notification.
- **No question or permission alerts:** confirm the request happened while a
  TUI with the plugin was connected.
- **Nothing:** set `"debug": true` in the plugin options and read
  `~/.config/opencode/opencode-notifier-debug.log`.
- **Plugin not loaded:** run `opencode plugin list` and check
  `~/.local/share/opencode/log/opencode.log` for plugin errors.

## How it works

The package has two parts:

- `src/index.ts` is a no-op server plugin. It exists so
  `opencode plugin add` can install the package.
- `src/tui.ts` is the TUI plugin. It listens to `session.execution.*`,
  `form.created` (question forms), and `permission.asked`, then shows a toast,
  plays a chime, and sends a Telegram message.

The Windows toast is rendered by `assets/show-task-toast.ps1`. Other platforms
call OpenCode's attention API.

## Development

```sh
# Local install
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Force

# Restart/reload OpenCode, then:
/task-alert-setup
/task-alert-test
```

## License

MIT
