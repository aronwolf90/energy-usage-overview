import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const REFRESH_SECONDS = 5;
const STALE_SECONDS = 30;

const PERIODS = [
    {id: 'now', label: 'Now'},
    {id: 'hour', label: 'Hour'},
    {id: 'day', label: 'Day'},
    {id: 'week', label: 'Week'},
    {id: 'month', label: 'Month'},
];

const PERIOD_TITLES = {
    now: 'right now',
    hour: 'in the last hour',
    day: 'in the last 24 hours',
    week: 'in the last 7 days',
    month: 'in the last 30 days',
};

function summaryFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_runtime_dir(), 'energy-usage-overview', 'summary.json',
    ]));
}

function formatWatts(w) {
    if (w >= 10)
        return `${w.toFixed(0)} W`;
    if (w >= 0.1)
        return `${w.toFixed(1)} W`;
    return `${(w * 1000).toFixed(0)} mW`;
}

function formatEnergy(joules) {
    const wh = joules / 3600;
    if (wh >= 1000)
        return `${(wh / 1000).toFixed(2)} kWh`;
    if (wh >= 10)
        return `${wh.toFixed(0)} Wh`;
    if (wh >= 1)
        return `${wh.toFixed(1)} Wh`;
    return `${(wh * 1000).toFixed(0)} mWh`;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h >= 24)
        return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0)
        return `${h}h ${m}m`;
    return `${m}m`;
}

const EnergyIndicator = GObject.registerClass(
class EnergyIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Energy Usage Overview');

        this._settings = extension.getSettings();
        this._summary = null;
        this._appCache = new Map();
        this._period = this._settings.get_string('default-period');

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                `${extension.path}/icons/energy-usage-symbolic.svg`),
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'euo-panel-label',
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._buildMenu();

        this._settingsIds = [
            this._settings.connect('changed::show-power-label', () => this._updatePanel()),
            this._settings.connect('changed::entries', () => this._updateList()),
        ];

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._setPeriod(this._settings.get_string('default-period'));
                this._refresh();
            }
        });

        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _buildMenu() {
        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const headerBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._headerLabel = new St.Label({text: 'Energy usage', style_class: 'euo-header'});
        this._subtitleLabel = new St.Label({text: '', style_class: 'euo-subtitle'});
        headerBox.add_child(this._headerLabel);
        headerBox.add_child(this._subtitleLabel);
        header.add_child(headerBox);
        this.menu.addMenuItem(header);

        const periodItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const periodBox = new St.BoxLayout({
            style_class: 'euo-periods',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._periodButtons = new Map();
        for (const {id, label} of PERIODS) {
            const button = new St.Button({
                label,
                style_class: 'button euo-period-button',
                toggle_mode: true,
                can_focus: true,
            });
            button.connect('clicked', () => this._setPeriod(id));
            periodBox.add_child(button);
            this._periodButtons.set(id, button);
        }
        periodItem.add_child(periodBox);
        this.menu.addMenuItem(periodItem);

        this._listSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._listSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._footer = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._footer.label.add_style_class_name('euo-subtitle');
        this.menu.addMenuItem(this._footer);

        this._syncPeriodButtons();
    }

    _setPeriod(id) {
        this._period = id;
        this._syncPeriodButtons();
        this._updateList();
    }

    _syncPeriodButtons() {
        for (const [id, button] of this._periodButtons)
            button.checked = id === this._period;
    }

    _refresh() {
        const file = summaryFile();
        file.load_contents_async(null, (f, res) => {
            if (!this._timeoutId)
                return; // destroyed meanwhile
            try {
                const [, contents] = f.load_contents_finish(res);
                this._summary = JSON.parse(new TextDecoder().decode(contents));
            } catch (e) {
                this._summary = null;
            }
            this._updatePanel();
            if (this.menu.isOpen)
                this._updateList();
        });
    }

    _isStale() {
        return !this._summary ||
            Date.now() / 1000 - this._summary.updated > STALE_SECONDS;
    }

    _updatePanel() {
        const show = this._settings.get_boolean('show-power-label');
        this._label.visible = show;
        if (this._isStale() || this._summary.power_watts === null)
            this._label.text = '–';
        else
            this._label.text = formatWatts(this._summary.power_watts);
    }

    _lookupApp(app) {
        if (this._appCache.has(app.app))
            return this._appCache.get(app.app);

        const appSystem = Shell.AppSystem.get_default();
        let shellApp = null;
        if (app.desktop_id)
            shellApp = appSystem.lookup_app(app.desktop_id);
        if (!shellApp)
            shellApp = appSystem.lookup_startup_wmclass(app.app);
        if (!shellApp)
            shellApp = appSystem.lookup_desktop_wmclass(app.app);
        if (!shellApp)
            shellApp = appSystem.lookup_heuristic_basename(app.app);

        this._appCache.set(app.app, shellApp);
        return shellApp;
    }

    _updateList() {
        this._listSection.removeAll();

        if (this._isStale()) {
            this._headerLabel.text = 'Collector not running';
            this._subtitleLabel.text = '';
            const item = new PopupMenu.PopupMenuItem(
                'Start it with:\nsystemctl --user enable --now energy-usage-collector',
                {reactive: false, can_focus: false});
            item.label.add_style_class_name('euo-warning');
            this._listSection.addMenuItem(item);
            this._footer.label.text = this._summary
                ? `Last update ${formatDuration(Date.now() / 1000 - this._summary.updated)} ago`
                : 'No data yet';
            return;
        }

        const summary = this._summary;
        const period = summary.periods[this._period];
        const isNow = this._period === 'now';

        if (!isNow)
            this._headerLabel.text = `${formatEnergy(period.total_joules)} used ${PERIOD_TITLES[this._period]}`;
        else if (summary.power_watts === null)
            this._headerLabel.text = 'Measuring…';
        else
            this._headerLabel.text = `Using ${formatWatts(summary.power_watts)} right now`;
        this._subtitleLabel.text = summary.source_label
            ? `Measured via ${summary.source_label}`
            : 'Waiting for the first measurement';

        const entries = this._settings.get_int('entries');
        const apps = period.apps.slice(0, entries);
        const total = period.total_joules || 1;
        const max = apps.length ? apps[0].joules || 1 : 1;

        if (apps.length === 0) {
            this._listSection.addMenuItem(new PopupMenu.PopupMenuItem(
                'No data for this period yet', {reactive: false, can_focus: false}));
        }

        for (const app of apps)
            this._listSection.addMenuItem(this._createRow(app, period, total, max, isNow));

        if (isNow && period.covered_seconds === 0) {
            this._footer.label.text = 'First sample in a few seconds';
        } else if (isNow) {
            this._footer.label.text =
                `Average over the last ${Math.round(period.covered_seconds)} s`;
        } else if (period.covered_seconds < period.seconds * 0.95) {
            this._footer.label.text =
                `Data available for ${formatDuration(period.covered_seconds)} of this period`;
        } else {
            const avg = period.total_joules / period.covered_seconds;
            this._footer.label.text = `Average ${formatWatts(avg)} while running`;
        }
    }

    _createRow(app, period, total, max, isNow) {
        const item = new PopupMenu.PopupBaseMenuItem();
        const row = new St.BoxLayout({style_class: 'euo-row', x_expand: true});

        const shellApp = this._lookupApp(app);
        if (shellApp)
            item.connect('activate', () => shellApp.activate());
        const icon = shellApp
            ? shellApp.create_icon_texture(24)
            : new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 24});
        row.add_child(icon);

        const nameBox = new St.BoxLayout({vertical: true, x_expand: true});
        nameBox.add_child(new St.Label({
            text: shellApp ? shellApp.get_name() : app.app,
            style_class: 'euo-row-name',
        }));
        const trough = new St.Widget({style_class: 'euo-bar-trough'});
        const bar = new St.Widget({
            style_class: 'euo-bar',
            style: `width: ${Math.max(1, Math.round(180 * app.joules / max))}px;`,
        });
        trough.add_child(bar);
        nameBox.add_child(trough);
        row.add_child(nameBox);

        const value = isNow
            ? formatWatts(app.joules / period.covered_seconds)
            : formatEnergy(app.joules);
        row.add_child(new St.Label({
            text: value,
            style_class: 'euo-row-value',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({
            text: `${Math.round(100 * app.joules / total)}%`,
            style_class: 'euo-row-percent',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        item.add_child(row);
        return item;
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        super.destroy();
    }
});

export default class EnergyUsageOverviewExtension extends Extension {
    enable() {
        this._indicator = new EnergyIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
