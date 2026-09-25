import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PERIODS = [
    ['now', 'Now'],
    ['hour', 'Last hour'],
    ['day', 'Last 24 hours'],
    ['week', 'Last 7 days'],
    ['month', 'Last 30 days'],
];

export default class EnergyUsageOverviewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Display'});
        page.add(group);

        const labelRow = new Adw.SwitchRow({
            title: 'Show power in panel',
            subtitle: 'Display the current power draw next to the icon',
        });
        settings.bind('show-power-label', labelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(labelRow);

        const entriesRow = new Adw.SpinRow({
            title: 'Programs listed',
            adjustment: new Gtk.Adjustment({lower: 3, upper: 25, step_increment: 1}),
        });
        settings.bind('entries', entriesRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(entriesRow);

        const periodRow = new Adw.ComboRow({
            title: 'Default period',
            model: Gtk.StringList.new(PERIODS.map(([, label]) => label)),
        });
        const current = PERIODS.findIndex(([id]) => id === settings.get_string('default-period'));
        periodRow.selected = Math.max(0, current);
        periodRow.connect('notify::selected', () => {
            settings.set_string('default-period', PERIODS[periodRow.selected][0]);
        });
        group.add(periodRow);

        window.add(page);
    }
}
