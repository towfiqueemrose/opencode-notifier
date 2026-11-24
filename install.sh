#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
dest="$config/plugins/opencode-notifier"

if [ -e "$dest" ]; then
  printf 'opencode-notifier is already installed at %s. Replace it? [y/N] ' "$dest"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) rm -rf "$dest" ;;
    *) echo "Cancelled."; exit 1 ;;
  esac
fi

mkdir -p "$dest"
cp -R "$root/src" "$root/assets" "$dest/"
cp "$root/package.json" "$root/README.md" "$root/LICENSE" "$dest/"

printf '\nInstalled opencode-notifier to %s\n' "$dest"
printf 'Restart OpenCode, then run /task-alert-setup in the TUI.\n\n'
