const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const CtrlAltTab = imports.ui.ctrlAltTab;
const Lang = imports.lang;
const Layout = imports.ui.layout;
const Main = imports.ui.main;

const STANDARD_TRAY_ICON_IMPLEMENTATIONS = {
    'bluetooth-applet': 'bluetooth',
    'gnome-volume-control-applet': 'volume', // renamed to gnome-sound-applet
                                             // when moved to control center
    'gnome-sound-applet': 'volume',
    'nm-applet': 'network',
    'gnome-power-manager': 'battery',
    'keyboard': 'keyboard',
    'a11y-keyboard': 'a11y',
    'kbd-scrolllock': 'keyboard',
    'kbd-numlock': 'keyboard',
    'kbd-capslock': 'keyboard',
    'ibus-ui-gtk': 'keyboard'
};

// Offset of the original position from the bottom-right corner
const CONCEALED_WIDTH = 3;
const REVEAL_ANIMATION_TIME = 0.2;
const TEMP_REVEAL_TIME = 2;

const BARRIER_THRESHOLD = 70;
const BARRIER_TIMEOUT = 1000;

const LegacyTray = new Lang.Class({
    Name: 'LegacyTray',

    _init: function() {
        this.actor = new St.Widget({ clip_to_allocation: true,
                                     layout_manager: new Clutter.BinLayout() });

        this.container = new St.BoxLayout({ style_class: 'legacy-tray-icon-box' });
        this.actor.add_actor(this.container);

        Main.layoutManager.addChrome(this.actor, { affectsInputRegion: false });
        Main.layoutManager.trackChrome(this.container, { affectsInputRegion: true });
        Main.uiGroup.set_child_below_sibling(this.actor, Main.layoutManager.modalDialogGroup);

        this._trayManager = new Shell.TrayManager();
        this._trayIconAddedId = this._trayManager.connect('tray-icon-added', Lang.bind(this, this._onTrayIconAdded));
        this._trayIconRemovedId = this._trayManager.connect('tray-icon-removed', Lang.bind(this, this._onTrayIconRemoved));
        this._trayManager.manage_screen(global.screen, this.actor);

        Main.layoutManager.connect('monitors-changed',
                                   Lang.bind(this, this._sync));
        global.screen.connect('in-fullscreen-changed',
                              Lang.bind(this, this._sync));
        Main.sessionMode.connect('updated', Lang.bind(this, this._sync));

        this._sync();
    },

    _onTrayIconAdded: function(tm, icon) {
        let wmClass = icon.wm_class ? icon.wm_class.toLowerCase() : '';
        if (STANDARD_TRAY_ICON_IMPLEMENTATIONS[wmClass] !== undefined)
            return;

        let button = new St.Button({ child: icon,
                                     style_class: 'legacy-tray-icon',
                                     button_mask: St.ButtonMask.ONE |
                                                  St.ButtonMask.TWO |
                                                  St.ButtonMask.THREE,
                                     can_focus: true,
                                     x_fill: true, y_fill: true });

        let app = Shell.WindowTracker.get_default().get_app_from_pid(icon.pid);
        if (!app)
            app = Shell.AppSystem.get_default().lookup_startup_wmclass(wmClass);
        if (!app)
            app = Shell.AppSystem.get_default().lookup_desktop_wmclass(wmClass);
        if (app)
            button.accessible_name = app.get_name();
        else
            button.accessible_name = icon.title;

        button.connect('clicked',
            function() {
                icon.click(Clutter.get_current_event());
            });
        button.connect('key-press-event',
            function() {
                icon.click(Clutter.get_current_event());
                return Clutter.EVENT_PROPAGATE;
            });

        this.container.add_actor(button);
    },

    _onTrayIconRemoved: function(tm, icon) {
        if (!this.actor.contains(icon))
            return;

        icon.get_parent().destroy();
        this._sync();
    },

    _sync: function() {
        // FIXME: we no longer treat tray icons as notifications
        let allowed = Main.sessionMode.hasNotifications;
        let hasIcons = this.container.get_n_children() > 0;
        this.actor.visible = allowed && hasIcons;
    }
});

Signals.addSignalMethods(LegacyTray.prototype);