#!/usr/bin/env bash
# Installs the collector (systemd user service) and the GNOME Shell extension
# for the current user. Re-run after pulling changes.
set -euo pipefail

cd "$(dirname "$0")"
UUID="energy-usage-overview@aronwolf90.github.io"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

echo "Installing collector to ~/.local/bin"
install -Dm755 collector/energy-usage-collector "$HOME/.local/bin/energy-usage-collector"
install -Dm644 systemd/energy-usage-collector.service \
    "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/energy-usage-collector.service"
systemctl --user daemon-reload
systemctl --user enable energy-usage-collector.service
systemctl --user restart energy-usage-collector.service

echo "Installing GNOME Shell extension to $EXT_DIR"
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r extension/. "$EXT_DIR/"
glib-compile-schemas "$EXT_DIR/schemas"

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions enable "$UUID"
    echo "Extension enabled."
else
    echo
    echo "GNOME Shell only discovers new extensions at login."
    echo "Log out and back in, then run:  gnome-extensions enable $UUID"
fi

if [[ "${1:-}" == "--rapl" ]]; then
    echo "Installing udev rule for RAPL access (needs sudo)"
    sudo install -Dm644 udev/99-energy-usage-overview-rapl.rules \
        /etc/udev/rules.d/99-energy-usage-overview-rapl.rules
    sudo chmod a+r /sys/class/powercap/intel-rapl:*/energy_uj
    systemctl --user restart energy-usage-collector.service
fi
