#!/usr/bin/env bash
# Removes the extension and collector. Pass --purge to also delete the history.
set -euo pipefail

UUID="energy-usage-overview@aronwolf90.github.io"
gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

systemctl --user disable --now energy-usage-collector.service 2>/dev/null || true
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/energy-usage-collector.service"
rm -f "$HOME/.local/bin/energy-usage-collector"
systemctl --user daemon-reload

if [[ "${1:-}" == "--purge" ]]; then
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/energy-usage-overview"
fi
[[ -f /etc/udev/rules.d/99-energy-usage-overview-rapl.rules ]] && \
    echo "Remove the RAPL udev rule with: sudo rm /etc/udev/rules.d/99-energy-usage-overview-rapl.rules"
exit 0
