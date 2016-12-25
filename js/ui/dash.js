// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Signals = imports.signals;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Mainloop = imports.mainloop;

const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const ViewSelector = imports.ui.viewSelector
const Workspace = imports.ui.workspace;

const DASH_ANIMATION_TIME = 0.2;
const DASH_ITEM_LABEL_SHOW_TIME = 0.15;
const DASH_ITEM_LABEL_HIDE_TIME = 0.1;
const DASH_ITEM_HOVER_TIMEOUT = 300;

function getAppFromSource(source) {
    if (source instanceof AppDisplay.AppIcon) {
        return source.app;
    } else {
        return null;
    }
}

// A container like StBin, but taking the child's scale into account
// when requesting a size
const DashItemContainer = new Lang.Class({
    Name: 'DashItemContainer',
    Extends: St.Widget,

    _init: function() {
        this.parent({ style_class: 'dash-item-container' });

        this._labelText = "";
        this.label = new St.Label({ style_class: 'dash-label'});
        this.label.hide();
        Main.layoutManager.addChrome(this.label);
        this.label_actor = this.label;

        this.child = null;
        this._childScale = 0;
        this._childOpacity = 0;
        this.animatingOut = false;
    },

    vfunc_allocate: function(box, flags) {
        this.set_allocation(box, flags);

        if (this.child == null)
            return;

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;
        let [minChildWidth, minChildHeight, natChildWidth, natChildHeight] =
            this.child.get_preferred_size();
        let [childScaleX, childScaleY] = this.child.get_scale();

        let childWidth = Math.min(natChildWidth * childScaleX, availWidth);
        let childHeight = Math.min(natChildHeight * childScaleY, availHeight);

        let childBox = new Clutter.ActorBox();
        childBox.x1 = (availWidth - childWidth) / 2;
        childBox.y1 = (availHeight - childHeight) / 2;
        childBox.x2 = childBox.x1 + childWidth;
        childBox.y2 = childBox.y1 + childHeight;

        this.child.allocate(childBox, flags);
    },

    vfunc_get_preferred_height: function(forWidth) {
        let themeNode = this.get_theme_node();

        if (this.child == null)
            return [0, 0];

        forWidth = themeNode.adjust_for_width(forWidth);
        let [minHeight, natHeight] = this.child.get_preferred_height(forWidth);
        return themeNode.adjust_preferred_height(minHeight * this.child.scale_y,
                                                 natHeight * this.child.scale_y);
    },

    vfunc_get_preferred_width: function(forHeight) {
        let themeNode = this.get_theme_node();

        if (this.child == null)
            return [0, 0];

        forHeight = themeNode.adjust_for_height(forHeight);
        let [minWidth, natWidth] = this.child.get_preferred_width(forHeight);
        return themeNode.adjust_preferred_width(minWidth * this.child.scale_y,
                                                natWidth * this.child.scale_y);
    },

    showLabel: function() {
        if (!this._labelText)
            return;

        this.label.set_text(this._labelText);
        this.label.opacity = 0;
        this.label.show();

        let [stageX, stageY] = this.get_transformed_position();

        let itemHeight = this.allocation.y2 - this.allocation.y1;

        let labelHeight = this.label.get_height();
        let yOffset = Math.floor((itemHeight - labelHeight) / 2)

        let y = stageY + yOffset;

        let node = this.label.get_theme_node();
        let xOffset = node.get_length('-x-offset');

        let x;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            x = stageX - this.label.get_width() - xOffset;
        else
            x = stageX + this.get_width() + xOffset;

        this.label.set_position(x, y);
        Tweener.addTween(this.label,
                         { opacity: 255,
                           time: DASH_ITEM_LABEL_SHOW_TIME,
                           transition: 'easeOutQuad',
                         });
    },

    setLabelText: function(text) {
        this._labelText = text;
        this.child.accessible_name = text;
    },

    hideLabel: function () {
        Tweener.addTween(this.label,
                         { opacity: 0,
                           time: DASH_ITEM_LABEL_HIDE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this.label.hide();
                           })
                         });
    },

    setChild: function(actor) {
        if (this.child == actor)
            return;

        this.destroy_all_children();

        this.child = actor;
        this.add_actor(this.child);

        this.child.set_scale_with_gravity(this._childScale, this._childScale,
                                          Clutter.Gravity.CENTER);

        this.child.set_opacity(this._childOpacity);
    },

    show: function(animate, targetOpacity = 1.0) {
        if (this.child == null)
            return;

        let time = animate ? DASH_ANIMATION_TIME : 0;
        Tweener.addTween(this,
                         { childScale: 1.0,
                           childOpacity: targetOpacity,
                           time: time,
                           transition: 'easeOutQuad'
                         });
    },

    destroy: function() {
        if (this.label)
            this.label.destroy();

        this.parent();
    },

    animateOutAndDestroy: function() {
        if (this.label)
            this.label.destroy();

        if (this.child == null) {
            this.destroy();
            return;
        }

        this.animatingOut = true;
        Tweener.addTween(this,
                         { childScale: 0.0,
                           childOpacity: 0,
                           time: DASH_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this.destroy();
                           })
                         });
    },

    set childScale(scale) {
        this._childScale = scale;

        if (this.child == null)
            return;

        this.child.set_scale_with_gravity(scale, scale,
                                          Clutter.Gravity.CENTER);
        this.queue_relayout();
    },

    get childScale() {
        return this._childScale;
    },

    set childOpacity(opacity) {
        this._childOpacity = Math.min(255, Math.max(0, opacity * 255));

        if (this.child == null)
            return;

        this.child.set_opacity(this._childOpacity);
        this.queue_redraw();
    },

    get childOpacity() {
        return this._childOpacity / 255;
    }
});

const ShowAppsIcon = new Lang.Class({
    Name: 'ShowAppsIcon',
    Extends: DashItemContainer,

    _init: function() {
        this.parent();

        this.button = new St.Button({ style_class: 'show-apps',
                                            track_hover: true,
                                            can_focus: true });
        this._iconActor = null;
        this.icon = new IconGrid.BaseIcon(_("Show Applications"),
                                           { setSizeManually: true,
                                             showLabel: false,
                                             createIcon: Lang.bind(this, this._createIcon) });
        this.button.add_actor(this.icon.actor);
        this.button._delegate = this;

        this.setChild(this.button);
        this.setDragApp(null);
    },

    _onPageChanged: function(emitter, page) {
        this.button.checked = page == ViewSelector.ViewPage.APPS;
    },

    _createIcon: function(size) {
        this._iconActor = new St.Icon({ icon_name: 'view-app-grid-symbolic',
                                        icon_size: size,
                                        style_class: 'show-apps-icon',
                                        track_hover: true });
        return this._iconActor;
    },

    attachViewSelector: function(viewSelector) {
        this.button.connect('clicked', Lang.bind(viewSelector, viewSelector.toggleApps));
        viewSelector.connect('page-changed', Lang.bind(this, this._onPageChanged));
    },

    _canRemoveApp: function(app) {
        if (app == null)
            return false;

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        let id = app.get_id();
        let isFavorite = AppFavorites.getAppFavorites().isFavorite(id);
        return isFavorite;
    },

    setDragApp: function(app) {
        let canRemove = this._canRemoveApp(app);

        this.button.set_hover(canRemove);
        if (this._iconActor)
            this._iconActor.set_hover(canRemove);

        if (canRemove)
            this.setLabelText(_("Remove from Favorites"));
        else
            this.setLabelText(_("Show Applications"));
    },

    handleDragOver: function(source, actor, x, y, time) {
        if (!this._canRemoveApp(getAppFromSource(source)))
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.MOVE_DROP;
    },

    acceptDrop: function(source, actor, x, y, time) {
        let app = getAppFromSource(source);
        if (!this._canRemoveApp(app))
            return false;

        let id = app.get_id();

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function () {
                AppFavorites.getAppFavorites().removeFavorite(id);
                return false;
            }));

        return true;
    }
});

const DragPlaceholderItem = new Lang.Class({
    Name: 'DragPlaceholderItem',
    Extends: DashItemContainer,

    _init: function(size) {
        this.parent();

        this.container = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                         x_expand: true, y_expand: true });
        this.icon = new St.Bin();
        this.icon.set_width(size);
        this.icon.set_height(size);
        this.container.add_actor(this.icon);
        this.container._delegate = this;

        this.setChild(this.container);
    }
});

const Dash = new Lang.Class({
    Name: 'Dash',

    _init : function() {
        this._maxHeight = -1;
        this.iconSize = 32;
        this._shownInitially = false;

        this._dragPlaceholder = null;
        this._dragPos = -1;
        this._animatingPlaceholdersCount = 0;
        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._labelShowing = false;
        this._offset = 0;

        this.container = new St.BoxLayout();
        this.container._delegate = this;

        this._showAppsIcon = new ShowAppsIcon();
        this._showAppsIcon.childScale = 1;
        this._showAppsIcon.childOpacity = 1;
        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(this._showAppsIcon);

        this.showAppsButton = this._showAppsIcon;
        this._offset++;

        this.container.insert_child_at_index(this._showAppsIcon, 0);

        this.actor = new St.Bin({ child: this.container });
        this.actor.connect('notify::height', Lang.bind(this,
            function() {
                if (this._maxHeight != this.actor.height)
                    this._queueRedisplay();
                this._maxHeight = this.actor.height;
            }));

        this._workId = Main.initializeDeferredWork(this.container, Lang.bind(this, this._redisplay));

        this._appSystem = Shell.AppSystem.get_default();

        this._appSystem.connect('installed-changed', Lang.bind(this, function() {
            AppFavorites.getAppFavorites().reload();
            this._queueRedisplay();
        }));
        AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._queueRedisplay));
        this._appSystem.connect('app-state-changed', Lang.bind(this, this._queueRedisplay));

        Main.overview.connect('item-drag-begin',
                              Lang.bind(this, this._onDragBegin));
        Main.overview.connect('item-drag-end',
                              Lang.bind(this, this._onDragEnd));
        Main.overview.connect('item-drag-cancelled',
                              Lang.bind(this, this._onDragCancelled));

        // Translators: this is the name of the dock/favorites area on
        // the left of the overview
        Main.ctrlAltTabManager.addGroup(this.actor, _("Dash"), 'user-bookmarks-symbolic');
    },

    _onDragBegin: function() {
        this._dragCancelled = false;
        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };
        DND.addDragMonitor(this._dragMonitor);

        if (this.container.get_n_children() == this._offset) {
            this._dragPlaceholder = new DragPlaceholderItem();
            this.container.insert_child_at_index(this._dragPlaceholder, 0);
            this._dragPlaceholder.show(true, 0);
        }
    },

    _onDragCancelled: function() {
        this._dragCancelled = true;
        this._endDrag();
    },

    _onDragEnd: function() {
        if (this._dragCancelled)
            return;

        this._endDrag();
    },

    _endDrag: function() {
        this._dragPos = -1;
        this._clearDragPlaceholder(true);
        this._showAppsIcon.setDragApp(null);
        DND.removeDragMonitor(this._dragMonitor);
    },

    _onDragMotion: function(dragEvent) {
        let app = getAppFromSource(dragEvent.source);
        if (app == null)
            return DND.DragMotionResult.CONTINUE;

        let showAppsHovered =
                this._showAppsIcon.contains(dragEvent.targetActor);

        if (!this.container.contains(dragEvent.targetActor) || showAppsHovered)
            this._clearDragPlaceholder(true);

        if (showAppsHovered)
            this._showAppsIcon.setDragApp(app);
        else
            this._showAppsIcon.setDragApp(null);

        return DND.DragMotionResult.CONTINUE;
    },

    _appIdListToHash: function(apps) {
        let ids = {};
        for (let i = 0; i < apps.length; i++)
            ids[apps[i].get_id()] = apps[i];
        return ids;
    },

    _queueRedisplay: function () {
        Main.queueDeferredWork(this._workId);
    },

    _hookUpLabel: function(item, appIcon) {
        item.child.connect('notify::hover', Lang.bind(this, function() {
            this._syncLabel(item, appIcon);
        }));

        let id = Main.overview.connect('hiding', Lang.bind(this, function() {
            this._labelShowing = false;
            item.hideLabel();
        }));
        item.child.connect('destroy', function() {
            Main.overview.disconnect(id);
        });

        if (appIcon) {
            appIcon.connect('sync-tooltip', Lang.bind(this, function() {
                this._syncLabel(item, appIcon);
            }));
        }
    },

    _createAppItem: function(app, draggable = true) {
        let appIcon = new AppDisplay.AppIcon(app,
                                             { isDraggable: draggable,
                                               setSizeManually: true,
                                               showLabel: false });

        appIcon.appIconInDash = appIcon;

        if (appIcon._draggable) {
            appIcon._draggable.connect('drag-begin',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 50;
                                       }));
            appIcon._draggable.connect('drag-end',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 255;
                                       }));
        }

        appIcon.connect('menu-state-changed',
                        Lang.bind(this, function(appIcon, opened) {
                            this._itemMenuStateChanged(item, opened);
                        }));

        let item = new DashItemContainer();
        item.setChild(appIcon.actor);
        appIcon.dashItem = item;

        // Override default AppIcon label_actor, now the
        // accessible_name is set at DashItemContainer.setLabelText
        appIcon.actor.label_actor = null;
        item.setLabelText(app.get_name());

        appIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(item, appIcon);

        return item;
    },

    _itemMenuStateChanged: function(item, opened) {
        // When the menu closes, it calls sync_hover, which means
        // that the notify::hover handler does everything we need to.
        if (opened) {
            if (this._showLabelTimeoutId > 0) {
                Mainloop.source_remove(this._showLabelTimeoutId);
                this._showLabelTimeoutId = 0;
            }

            item.hideLabel();
        }
    },

    _syncLabel: function (item, appIcon) {
        let shouldShow = appIcon ? appIcon.shouldShowTooltip() : item.child.get_hover();

        if (shouldShow) {
            if (this._showLabelTimeoutId == 0) {
                let timeout = this._labelShowing ? 0 : DASH_ITEM_HOVER_TIMEOUT;
                this._showLabelTimeoutId = Mainloop.timeout_add(timeout,
                    Lang.bind(this, function() {
                        this._labelShowing = true;
                        item.showLabel();
                        this._showLabelTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
                GLib.Source.set_name_by_id(this._showLabelTimeoutId, '[gnome-shell] item.showLabel');
                if (this._resetHoverTimeoutId > 0) {
                    Mainloop.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showLabelTimeoutId > 0)
                Mainloop.source_remove(this._showLabelTimeoutId);
            this._showLabelTimeoutId = 0;
            item.hideLabel();
            if (this._labelShowing) {
                this._resetHoverTimeoutId = Mainloop.timeout_add(DASH_ITEM_HOVER_TIMEOUT,
                    Lang.bind(this, function() {
                        this._labelShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
                GLib.Source.set_name_by_id(this._resetHoverTimeoutId, '[gnome-shell] this._labelShowing');
            }
        }
    },

    _redisplay: function () {
        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let running = this._appSystem.get_running();

        let children = this.container.get_children().filter(function(actor) {
                return actor.child &&
                       actor.child._delegate &&
                       actor.child._delegate.app;
            });
        // Apps currently in the dash
        let oldApps = children.filter(function(actor) {
                // Filter anything that is not an app
                return actor.child._delegate.app !== undefined;
            }).map(function(actor) {
                return actor.child._delegate.app;
            });
        // Apps supposed to be in the dash
        let newApps = [];

        for (let id in favorites)
            newApps.push(favorites[id]);

        for (let i = 0; i < running.length; i++) {
            let app = running[i];
            if (app.get_id() in favorites)
                continue;
            newApps.push(app);
        }

        // Figure out the actual changes to the list of items; we iterate
        // over both the list of items currently in the dash and the list
        // of items expected there, and collect additions and removals.
        // Moves are both an addition and a removal, where the order of
        // the operations depends on whether we encounter the position
        // where the item has been added first or the one from where it
        // was removed.
        // There is an assumption that only one item is moved at a given
        // time; when moving several items at once, everything will still
        // end up at the right position, but there might be additional
        // additions/removals (e.g. it might remove all the launchers
        // and add them back in the new order even if a smaller set of
        // additions and removals is possible).
        // If above assumptions turns out to be a problem, we might need
        // to use a more sophisticated algorithm, e.g. Longest Common
        // Subsequence as used by diff.
        let addedItems = [];
        let removedActors = [];

        let newIndex = 0;
        let oldIndex = 0;
        while (newIndex < newApps.length || oldIndex < oldApps.length) {
            // No change at oldIndex/newIndex
            if (oldApps[oldIndex] == newApps[newIndex]) {
                oldIndex++;
                newIndex++;
                continue;
            }

            // App removed at oldIndex
            if (oldApps[oldIndex] &&
                newApps.indexOf(oldApps[oldIndex]) == -1) {
                removedActors.push(children[oldIndex]);
                oldIndex++;
                continue;
            }

            // App added at newIndex
            if (newApps[newIndex] &&
                oldApps.indexOf(newApps[newIndex]) == -1) {
                let app = newApps[newIndex];
                let newItem = this._createAppItem(app, app.get_id() in favorites);                
                addedItems.push({ app: app,
                                  item: newItem,
                                  pos: newIndex });
                newIndex++;
                continue;
            }

            // App moved
            let insertHere = newApps[newIndex + 1] &&
                             newApps[newIndex + 1] == oldApps[oldIndex];
            let alreadyRemoved = removedActors.reduce(function(result, actor) {
                let removedApp = actor.child._delegate.app;
                return result || removedApp == newApps[newIndex];
            }, false);

            if (insertHere || alreadyRemoved) {
                let app = newApps[newIndex];
                let newItem = this._createAppItem(app, app.get_id() in favorites);
                addedItems.push({ app: newApps[newIndex],
                                  item: newItem,
                                  pos: newIndex + removedActors.length });
                newIndex++;
            } else {
                removedActors.push(children[oldIndex]);
                oldIndex++;
            }
        }

        for (let i = 0; i < addedItems.length; i++)
            this.container.insert_child_at_index(addedItems[i].item,
                                                 addedItems[i].pos + this._offset);

        for (let i = 0; i < removedActors.length; i++) {
            let item = removedActors[i];

            // Don't animate item removal when the overview is transitioning
            // or hidden
            if (Main.overview.visible && !Main.overview.animationInProgress)
                item.animateOutAndDestroy();
            else
                item.destroy();
        }

        // Skip animations on first run when adding the initial set
        // of items, to avoid all items zooming in at once

        let animate = this._shownInitially && Main.overview.visible &&
            !Main.overview.animationInProgress;

        if (!this._shownInitially)
            this._shownInitially = true;

        for (let i = 0; i < addedItems.length; i++) {
            addedItems[i].item.show(animate);
        }

        // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
        // Without it, StBoxLayout may use a stale size cache
        this.container.queue_relayout();
    },

    _clearDragPlaceholder: function(anim) {
        if (this._dragPlaceholder) {
            this._animatingPlaceholdersCount++;
            if (anim) {
                this._dragPlaceholder.animateOutAndDestroy();
                this._dragPlaceholder.connect('destroy',
                    Lang.bind(this, function() {
                        this._animatingPlaceholdersCount--;
                    }));
            } else
                this._dragPlaceholder.destroy();
            this._dragPlaceholder = null;
        }
    },

    handleDragOver : function(source, actor, x, y, time) {
        let app = getAppFromSource(source);

        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed())
            return DND.DragMotionResult.NO_DROP;

        if (!global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        let favorites = AppFavorites.getAppFavorites().getFavorites();
        let numFavorites = favorites.length;
        let srcIsFavorite = favorites.indexOf(app) != -1;
        
        if (this._dragPlaceholder || !srcIsFavorite)
            numFavorites++;

        let children = this.container.get_children();
        let numChildren = children.length;
        let boxWidth = this.container.width;

        let pos = Math.floor(x * numChildren / boxWidth);

        // Only drop in favorite area
        if (pos < this._offset)
            this._dragPos = this._offset;
        else if (pos - this._offset >= numFavorites)
            this._dragPos = this._offset + numFavorites - 1;
        else
            this._dragPos = pos;

        // Create a placeholder if this is not a favorite app
        if (!this._dragPlaceholder && !srcIsFavorite) {
            this._dragPlaceholder = this._createAppItem(app, true);
            this.container.insert_child_at_index(this._dragPlaceholder, pos);
            this._dragPlaceholder.show(true, 0.2);
        }
        
        let item;
        if (source.dashItem && srcIsFavorite)
            item = source.dashItem;
        else
            item = this._dragPlaceholder;

        this.container.set_child_at_index(item, this._dragPos);

        if (srcIsFavorite)
            return DND.DragMotionResult.MOVE_DROP;

        return DND.DragMotionResult.COPY_DROP;
    },

    // Draggable target interface
    acceptDrop : function(source, actor, x, y, time) {
        let app = getAppFromSource(source);

        if (this._dragPos == -1)
            return false;

        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed()) {
            return false;
        }

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        let id = app.get_id();

        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let srcIsFavorite = (id in favorites);

        let favPos = this._dragPos - this._offset;

        // Promote placeholder to real item
        if (this._dragPlaceholder) {
            this._dragPlaceholder.show(true, 1.0);
            this._dragPlaceholder = null;
        }

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function () {
                let appFavorites = AppFavorites.getAppFavorites();
                if (srcIsFavorite)
                    appFavorites.moveFavoriteToPos(id, favPos);
                else
                    appFavorites.addFavoriteAtPos(id, favPos);
                return false;
            }));

        return true;
    }
});

Signals.addSignalMethods(Dash.prototype);
