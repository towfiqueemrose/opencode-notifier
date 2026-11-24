# OpenCode Notifier

Desktop notifications, attention chimes, and Telegram messages for
[OpenCode](https://opencode.ai) 2.4+.

Get a toast, a chime, and a Telegram message when OpenCode finishes a task or
needs your input.

[Download the PDF installation guide](docs/install-guide.pdf)

## Quick start

1. Install the plugin:

   ```sh
   opencode plugin add github:towfiqueemrose/opencode-notifier
   ```

2. Restart the OpenCode TUI.

3. Create a bot with **@BotFather** in Telegram and copy its token.

4. In OpenCode, run:

   ```text
   /notifier
   ```

5. Paste the token, press **Start** in the bot chat, then choose
   **Check again** in the wizard.

6. Verify delivery:

   ```text
   /notifier-test
   ```

## Commands

| Command | Purpose |
| --- | --- |
| `/notifier` | Configure the Telegram bot token and chat |
| `/notifier-test` | Test toast, chime, and Telegram delivery |
| `/notifier-setup`, `/task-alert-setup` | Aliases for `/notifier` |
| `/notifiertest`, `/task-alert-test` | Aliases for `/notifier-test` |

## What it does

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

Choose **one** method. Installing both the GitHub package and the zip creates
two copies of the same plugin.

### Option 1: GitHub (recommended)

```sh
opencode plugin add github:towfiqueemrose/opencode-notifier
```

Restart the OpenCode TUI after installing. A full restart is the reliable way
to load a newly installed TUI plugin; `/reload` may not pick it up.

### Option 2: Zip (offline)

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
sh ./install.sh
```

The installer copies the plugin to
`~/.config/opencode/plugins/opencode-notifier` (or
`$XDG_CONFIG_HOME/opencode/plugins/opencode-notifier`). Restart OpenCode, then
run `/notifier`.

### Verify the install

From your home directory:

```sh
opencode plugin list
```

You should see `opencode-notifier`. Then restart the TUI and try `/notifier`.

### Update

```sh
opencode plugin update github:towfiqueemrose/opencode-notifier
```

Restart the TUI after updating. A bare GitHub entry stays on the installed
commit until you update it.

## Set up Telegram

Each person needs their own bot. Never share a bot token.

1. Open **@BotFather** in Telegram and send `/newbot`.
2. Choose a display name and a username ending in `bot`.
3. Copy the token BotFather sends you.
4. In OpenCode, run:

   ```text
   /notifier
   ```

5. Paste the token. The wizard validates it with Telegram and shows the bot
   username.
6. Open `https://t.me/<botusername>` and press **Start**.
7. Return to OpenCode and choose **Check again**. The wizard finds the chat
   automatically.
8. It sends a test message and saves the credentials.

If the bot has a webhook, automatic chat detection is blocked. The wizard asks
for the chat ID instead; get it from **@userinfobot**.

Test the whole path with:

```text
/notifier-test
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

The plugin works with its defaults; no manual configuration is required.
`opencode plugin add` writes the plugin entry for you.

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

To pass options, use an object entry in `opencode.json(c)` instead of the
string entry:

```jsonc
{
  "plugins": [
    {
      "package": "github:towfiqueemrose/opencode-notifier",
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

The shared package uses OpenCode's built-in chimes. If you already override
`attention.sounds` in `cli.json`, your overrides are respected.

## Disable and uninstall

Remove the GitHub install:

```sh
opencode plugin remove github:towfiqueemrose/opencode-notifier
```

For the zip install, delete:

```text
~/.config/opencode/plugins/opencode-notifier
```

To disable without removing, add `"-opencode-notifier"` to the `plugins` array
in your global `opencode.json(c)`.

Your `telegram.json` is not deleted automatically. Remove it yourself if you
want to erase the credentials.

## Troubleshooting

- **`/notifier` is missing from the slash menu:** fully restart the TUI and
  try again. Check `opencode plugin list`; try the aliases. A newly installed
  TUI plugin is not always loaded by `/reload` alone.
- **Telegram says `chat not found`:** open the bot and press **Start**, then
  run `/notifier` again.
- **No Telegram messages at all:** check `telegram.json` exists and
  `"enabled": true`; run `/notifier-test`. If you use environment variables,
  confirm they are visible to the OpenCode process.
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
call OpenCode's attention API. Commands are registered in a global keymap
layer so they are available from the home screen and inside sessions.

## Development

```sh
# Local install from this checkout
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Force

# Restart/reload OpenCode, then:
/notifier
/notifier-test
```

## License

MIT
