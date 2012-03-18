// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const ModalDialog = imports.ui.modalDialog;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;

const _f = imports.gettext.domain('frippery-bottom-panel').gettext;

function WindowListItem(app, metaWindow) {
    this._init(app, metaWindow);
}

WindowListItem.prototype = {
    _init: function(app, metaWindow) {
        this._itemBox = new St.BoxLayout({ style_class: 'window-list-item-box' });
        this._delegate = this;
        this.metaWindow = metaWindow;

        this.icon = app.create_icon_texture(16);
        let title = metaWindow.title;
        //this.actor.set_tooltip_text(title);
        if ( !metaWindow.showing_on_its_workspace() ) {
            title = '[' + title + ']';
        }
        this.label = new St.Label({ style_class: 'window-list-item-label',
                                    text: title });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._itemBox.add(this.icon, { x_fill: false, y_fill: false });
        this._itemBox.add(this.label, { x_fill: true, y_fill: false });

        this._notifyTitleId = metaWindow.connect('notify::title', Lang.bind(this, this._onTitleChanged));
        this.actor = new St.Bin({ child: this._itemBox,
                                  reactive: true,
                                  can_focus: true });

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
    },

     _onTitleChanged: function(w) {
         let title = w.title;
         //this.actor.set_tooltip_text(title);
         if ( !w.showing_on_its_workspace() ) {
             title = '[' + title + ']';
         }
         this.label.text = title;
    },

    _onDestroy: function() {
        this.metaWindow.disconnect(this._notifyTitleId);
    },

    _onButtonPress: function() {
        if ( this.metaWindow.has_focus() ) {
            this.metaWindow.minimize(global.get_current_time());
        }
        else {
            this.metaWindow.activate(global.get_current_time());
        }
    },

    doMinimize: function() {
        this.label.text = '[' + this.metaWindow.title + ']';
        this.icon.opacity = 127;
    },

    doMap: function() {
        this.label.text = this.metaWindow.title;
        this.icon.opacity = 255;
    },

    doFocus: function() {
        if ( this.metaWindow.has_focus() ) {
            this._itemBox.add_style_pseudo_class('focused');
        }
        else {
            this._itemBox.remove_style_pseudo_class('focused');
        }
    }
};

function WindowList() {
    this._init();
}

WindowList.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ name: 'windowList',
                                        style_class: 'window-list-box' });
        this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));
        this.actor._delegate = this;
        this._windows = [];

        let tracker = Shell.WindowTracker.get_default();
        tracker.connect('notify::focus-app', Lang.bind(this, this._onFocus));

        global.window_manager.connect('switch-workspace',
                                        Lang.bind(this, this._refreshItems));
        global.window_manager.connect('minimize',
                                        Lang.bind(this, this._onMinimize));
        global.window_manager.connect('map', Lang.bind(this, this._onMap));

        this._workspaces = [];
        this._changeWorkspaces();

        global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._changeWorkspaces));

        this._refreshItems();
    },

    _onFocus: function() {
        for ( let i = 0; i < this._windows.length; ++i ) {
            this._windows[i].doFocus();
        }
    },

    _refreshItems: function() {
        this.actor.destroy_children();
        this._windows = [];

        let metaWorkspace = global.screen.get_active_workspace();
        let windows = metaWorkspace.list_windows();
        windows.sort(function(w1, w2) {
            return w1.get_stable_sequence() - w2.get_stable_sequence();
        });

        // Create list items for each window
        let tracker = Shell.WindowTracker.get_default();
        for ( let i = 0; i < windows.length; ++i ) {
            let metaWindow = windows[i];
            if ( metaWindow && tracker.is_window_interesting(metaWindow) ) {
                let app = tracker.get_window_app(metaWindow);
                if ( app ) {
                    let item = new WindowListItem(app, metaWindow);
                    this._windows.push(item);
                    this.actor.add(item.actor);
                }
            }
        }

        this._onFocus();
    },

    _onMinimize: function(shellwm, actor) {
        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == actor.get_meta_window() ) {
                this._windows[i].doMinimize();
                return;
            }
        }
    },

    _onMap: function(shellwm, actor) {
        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == actor.get_meta_window() ) {
                this._windows[i].doMap();
                return;
            }
        }
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                return;
            }
        }

        let tracker = Shell.WindowTracker.get_default();
        let app = tracker.get_window_app(metaWindow);
        if ( app && tracker.is_window_interesting(metaWindow) ) {
            let item = new WindowListItem(app, metaWindow);
            this._windows.push(item);
            this.actor.add(item.actor);
        }
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                this.actor.remove_actor(this._windows[i].actor);
                this._windows[i].actor.destroy();
                this._windows.splice(i, 1);
                break;
            }
        }
    },

    _changeWorkspaces: function() {
        for ( let i=0; i<this._workspaces.length; ++i ) {
            let ws = this._workspaces[i];
            ws.disconnect(ws._windowAddedId);
            ws.disconnect(ws._windowRemovedId);
        }

        this._workspaces = [];
        for ( let i=0; i<global.screen.n_workspaces; ++i ) {
            let ws = global.screen.get_workspace_by_index(i);
            this._workspaces[i] = ws;
            ws._windowAddedId = ws.connect('window-added',
                                    Lang.bind(this, this._windowAdded));
            ws._windowRemovedId = ws.connect('window-removed',
                                    Lang.bind(this, this._windowRemoved));
        }
    },

    _onScrollEvent: function(actor, event) {
        let active = global.screen.get_active_workspace_index();
        let direction = event.get_scroll_direction();
        let idx = 0;

        for (idx=0;idx<this._windows[active].length;++idx) {
            if (this._windows[active][idx].metaWindow.has_focus())
                break;
        }

        if (idx==this._windows[active].length)
            return;

        if (direction==Clutter.ScrollDirection.DOWN && idx!=this._windows[active].length-1) {
            idx+=1;
        } else if (direction==Clutter.ScrollDirection.UP && idx!=0) {
            idx-=1;
        }

        this._windows[active][idx].metaWindow.activate(global.get_current_time());

        return true;
    }
};

let nrows = 1;

function get_ncols() {
    let ncols = Math.floor(global.screen.n_workspaces/nrows);
    if ( global.screen.n_workspaces%nrows != 0 )
       ++ncols

    return ncols;
}

function WorkspaceDialog() {
    this._init();
}

WorkspaceDialog.prototype = {
    __proto__: ModalDialog.ModalDialog.prototype,

    _init: function() {
        ModalDialog.ModalDialog.prototype._init.call(this, { styleClass: 'workspace-dialog' });

        let label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Number of workspaces') });
        this.contentLayout.add(label, { y_align: St.Align.START });

        let entry = new St.Entry({ style_class: 'workspace-dialog-entry' });

        this._workspaceEntry = entry.clutter_text;
        this.contentLayout.add(entry, { y_align: St.Align.START });
        this.setInitialKeyFocus(this._workspaceEntry);

        this._workspaceEntry.connect('key-press-event',
                Lang.bind(this, this._onKeyPress));

        label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Rows in workspace switcher') });
        this.contentLayout.add(label, { y_align: St.Align.START });

        entry = new St.Entry({ style_class: 'workspace-dialog-entry' });

        this._rowEntry = entry.clutter_text;
        this.contentLayout.add(entry, { y_align: St.Align.START });

        this._rowEntry.connect('key-press-event',
                Lang.bind(this, this._onKeyPress));

    },

    open: function() {
        this._workspaceEntry.set_text(''+global.screen.n_workspaces);
        this._rowEntry.set_text(''+nrows);

        ModalDialog.ModalDialog.prototype.open.call(this);
    },

    _onKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
            let num = parseInt(this._workspaceEntry.get_text());
            if ( !isNaN(num) && num >= 2 && num <= 32 ) {
                let old_num = global.screen.n_workspaces;
                if ( num > old_num ) {
                    for ( let i=old_num; i<num; ++i ) {
                        global.screen.append_new_workspace(false,
                                global.get_current_time());
                    }
                }
                else if ( num < old_num ) {
                    for ( let i=old_num-1; i>=num; --i ) {
                        let ws = global.screen.get_workspace_by_index(i);
                        global.screen.remove_workspace(ws,
                                global.get_current_time());
                    }
                }
            }

            let rows = parseInt(this._rowEntry.get_text());
            if ( !isNaN(rows) && rows > 0 && rows < 6 && rows != nrows ) {
                nrows = rows;
                bottomPanel.workspaceSwitcher._createButtons();

                let rowFilePath = GLib.get_home_dir() + '/.frippery_rows';
                let rowFile = Gio.file_new_for_path(rowFilePath);
                rowFile.replace_contents(''+rows+'\n', null, false, 0, null);
            }

            this.close();
            return true;
        }
        else if (symbol == Clutter.Escape) {
            this.close();
            return true;
        }
        else if (symbol == Clutter.Tab) {
            if ( actor == this._rowEntry ) {
                global.stage.set_key_focus(this._workspaceEntry);
            }
            else {
                global.stage.set_key_focus(this._rowEntry);
            }
            return true;
        }
        else if (symbol == Clutter.Up && actor == this._rowEntry) {
            global.stage.set_key_focus(this._workspaceEntry);
            return true;
        }
        else if (symbol == Clutter.Down && actor == this._workspaceEntry) {
            global.stage.set_key_focus(this._rowEntry);
            return true;
        }

        return false;
    }
};
Signals.addSignalMethods(WorkspaceDialog.prototype);

function WorkspaceSwitcher() {
    this._init();
}

WorkspaceSwitcher.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ name: 'workspaceSwitcher',
                                        style_class: 'workspace-switcher',
                                        reactive: true });
        this.actor.connect('button-release-event', this._showDialog);
        this.actor.connect('scroll-event', this._onScroll);
        this.actor._delegate = this;
        this.button = [];
        this._createButtons();

        global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._createButtons));
        global.window_manager.connect('switch-workspace',
                                Lang.bind(this, this._updateButtons));
    },

    _createButtons: function() {
        this.actor.destroy_children();
        this.button = [];

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        this.row_indicator = null;
        if ( nrows > 1 ) {
            this.row_indicator = new St.DrawingArea({ reactive: true,
                                    style_class: 'workspace-row-indicator' });
            this.row_indicator.connect('repaint', Lang.bind(this, this._draw));
            this.row_indicator.connect('button-press-event', Lang.bind(this, this._rowButtonPress));
            this.row_indicator.connect('scroll-event', Lang.bind(this, this._rowScroll));
            this.actor.add(this.row_indicator);
        }

        for ( let i=0; i<ncols; ++i ) {
            let index = row*ncols + i;

            this.button[i] = new St.Button({ name: 'workspaceButton',
                                     style_class: 'workspace-button',
                                     reactive: true });
            let text = '';
            if ( index == active ) {
                text = '-' + (index+1).toString() + '-';
                this.button[i].add_style_pseudo_class('outlined');
            }
            else if ( index < global.screen.n_workspaces ) {
                text = (index+1).toString();
            }
            let label = new St.Label({ text: text });
            this.button[i].set_child(label);
            this.actor.add(this.button[i]);
            this.button[i].connect('clicked', Lang.bind(this, this._onClicked));
        }

        global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT,
                false, nrows, ncols);

    },

    _updateButtons: function() {
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        for ( let i=0; i<this.button.length; ++i ) {
            let index = row*ncols + i;

            if ( index == active ) {
                this.button[i].get_child().set_text('-' + (index+1).toString() + '-');
                this.button[i].add_style_pseudo_class('outlined');
            }
            else if ( index < global.screen.n_workspaces ) {
                this.button[i].get_child().set_text((index+1).toString());
                this.button[i].remove_style_pseudo_class('outlined');
            }
            else {
                this.button[i].get_child().set_text('');
                this.button[i].remove_style_pseudo_class('outlined');
            }
        }

        if ( this.row_indicator ) {
            this.row_indicator.queue_repaint();
        }
    },

    _showDialog: function(actor, event) {
        let button = event.get_button();
        if ( button == 3 ) {
            if ( this._workspaceDialog == null ) {
                this._workspaceDialog = new WorkspaceDialog();
            }
            this._workspaceDialog.open();
            return true;
        }
        return false;
    },

    _onClicked: function(btn) {
        let i;
        for ( i=0; i<this.button.length; ++i ) {
            if ( this.button[i] == btn ) {
                break;
            }
        }

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);
        let index = row*ncols + i;

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _onScroll: function(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let index = global.screen.n_workspaces;

        if ( direction == Clutter.ScrollDirection.UP ) {
            if ( active%ncols > 0 ) {
                index = active-1;
            }
        }
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            if ( active < global.screen.n_workspaces-1 &&
                         active%ncols != ncols-1 ) {
                index = active+1;
            }
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _rowButtonPress: function(actor, event) {
        if ( event.get_button() != 1 ) {
            return false;
        }

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let [x, y] = event.get_coords();
        let [wx, wy] = actor.get_transformed_position();
        let [w, h] = actor.get_size();
        y -= wy;

        let new_row = Math.floor(nrows*y/h);
        let index = global.screen.n_workspaces;
        if ( new_row != row ) {
            index = new_row*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _rowScroll: function(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = global.screen.n_workspaces;
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            index = (row+1)*ncols + active%ncols;
        }
        if ( direction == Clutter.ScrollDirection.UP ) {
            index = (row-1)*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _draw: function(area) {
        let [width, height] = area.get_surface_size();
        let themeNode = this.row_indicator.get_theme_node();
        let cr = area.get_context();

        let active_color = themeNode.get_color('-active-color');
        let inactive_color = themeNode.get_color('-inactive-color');

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        for ( let i=0; i<nrows; ++i ) {
            let y = (i+1)*height/(nrows+1);
            cr.moveTo(0, y);
            cr.lineTo(width, y);
            let color = row == i ? active_color : inactive_color;
            Clutter.cairo_set_source_color(cr, color);
            cr.setLineWidth(2.0);
            cr.stroke();
        }
    }
};

function MessageButton() {
    this._init();
}

MessageButton.prototype = {
    _init: function() {
        this.actor = new St.Button({ name: 'messageButton',
                                     style_class: 'message-button',
                                     reactive: true });
        let text = '!';
        if ( Main.messageTray._summary.get_children().length == 0 ) {
            text = ' ';
        }
        this.messageLabel = new St.Label({ text: text });
        this.actor.set_child(this.messageLabel);
        this.actor.connect('clicked', Lang.bind(this, function() {
            Main.messageTray.toggleState();
        }));

        this.actorAddedId = Main.messageTray._summary.connect('actor-added',
            Lang.bind(this, function() {
                this.messageLabel.set_text('!');
        }));

        this.actorRemovedId = Main.messageTray._summary.connect('actor-removed',
            Lang.bind(this, function() {
                if ( Main.messageTray._summary.get_children().length == 0 ) {
                    this.messageLabel.set_text(' ');
                }
        }));
    }
};


function BottomPanel() {
    this._init();
}

BottomPanel.prototype = {
    _init : function() {
        this.actor = new St.BoxLayout({ style_class: 'bottom-panel',
                                        name: 'bottomPanel',
                                        reactive: true });
        this.actor._delegate = this;

        let windowList = new WindowList();
        this.actor.add(windowList.actor, { expand: true });

        this.messageButton = new MessageButton();
        this.actor.add(this.messageButton.actor);

        this.workspaceSwitcher = new WorkspaceSwitcher();
        this.actor.add(this.workspaceSwitcher.actor);

        Main.layoutManager.addChrome(this.actor, { affectsStruts: true });

        this.actor.connect('style-changed', Lang.bind(this, this.relayout));
        global.screen.connect('monitors-changed', Lang.bind(this,
                                                     this.relayout));
    },

    relayout: function() {
        let primary = Main.layoutManager.primaryMonitor;

        let h = this.actor.get_theme_node().get_height();
        this.actor.set_position(primary.x, primary.y+primary.height-h);
        this.actor.set_size(primary.width, -1);
    },
};

const UP = 1;
const DOWN = 2;
const LEFT = 3;
const RIGHT = 4;

const FRIPPERY_TIMEOUT = 400;

function FripperySwitcherPopup() {
    this._init();
}

FripperySwitcherPopup.prototype = {
    __proto__: WorkspaceSwitcherPopup.WorkspaceSwitcherPopup.prototype,

    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children = this._list.get_children();
        let primary = Main.layoutManager.primaryMonitor;

        let availHeight = primary.height;
        availHeight -= Main.panel.actor.height;
        availHeight -= bottomPanel.actor.height;
        availHeight -= this.actor.get_theme_node().get_vertical_padding();
        availHeight -= this._container.get_theme_node().get_vertical_padding();
        availHeight -= this._list.get_theme_node().get_vertical_padding();

        let [childMinHeight, childNaturalHeight] = children[0].get_preferred_height(-1);

        let height = nrows * childNaturalHeight;

        let spacing = this._itemSpacing * (nrows - 1);
        height += spacing;
        height = Math.min(height, availHeight);

        this._childHeight = (height - spacing) / nrows;

        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let children = this._list.get_children();
        let primary = Main.layoutManager.primaryMonitor;

        let availWidth = primary.width;
        availWidth -= this.actor.get_theme_node().get_horizontal_padding();
        availWidth -= this._container.get_theme_node().get_horizontal_padding();
        availWidth -= this._list.get_theme_node().get_horizontal_padding();

        let ncols = get_ncols();

        let [childMinHeight, childNaturalHeight] = children[0].get_preferred_height(-1);
        let childNaturalWidth = childNaturalHeight * primary.width/primary.height;

        let width = ncols * childNaturalWidth;

        let spacing = this._itemSpacing * (ncols - 1);
        width += spacing;
        width = Math.min(width, availWidth);

        this._childWidth = (width - spacing) / ncols;

        alloc.min_size = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children();
        let childBox = new Clutter.ActorBox();

        let ncols = get_ncols();

        for ( let ir=0; ir<nrows; ++ir ) {
            for ( let ic=0; ic<ncols; ++ic ) {
                let i = ncols*ir + ic;
                let x = box.x1 + ic * (this._childWidth + this._itemSpacing);
                childBox.x1 = x;
                childBox.x2 = x + this._childWidth;
                let y = box.y1 + ir * (this._childHeight + this._itemSpacing);
                childBox.y1 = y;
                childBox.y2 = y + this._childHeight;
                children[i].allocate(childBox, flags);
            }
        }
    },

    _redraw : function(direction, activeWorkspaceIndex) {
        this._list.destroy_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
            let indicator = null;

           if (i == activeWorkspaceIndex && direction == LEFT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-left' });
           else if(i == activeWorkspaceIndex && direction == RIGHT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-right' });
           else if (i == activeWorkspaceIndex && direction == UP)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-up' });
           else if(i == activeWorkspaceIndex && direction == DOWN)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-down' });
           else
               indicator = new St.Bin({ style_class: 'ws-switcher-box' });

           this._list.add_actor(indicator);

        }
    },

    display : function(direction, activeWorkspaceIndex) {
        this._redraw(direction, activeWorkspaceIndex);
        if (this._timeoutId != 0)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = Mainloop.timeout_add(FRIPPERY_TIMEOUT, Lang.bind(this, this._onTimeout));
        this._show();
    }
};

let myShowTray, origShowTray;
let myShowWorkspaceSwitcher, origShowWorkspaceSwitcher;
let myActionMoveWorkspaceLeft, origActionMoveWorkspaceLeft;
let myActionMoveWorkspaceRight, origActionMoveWorkspaceRight;
let myActionMoveWorkspaceDown, origActionMoveWorkspaceDown;
let myActionMoveWorkspaceUp, origActionMoveWorkspaceUp;

function init(extensionMeta) {
    let localePath = extensionMeta.path + '/locale';
    imports.gettext.bindtextdomain('frippery-bottom-panel', localePath);

    // Yes, I know, I should use a schema
    let rowFilePath = GLib.get_home_dir() + '/.frippery_rows';
    let rowFile = Gio.file_new_for_path(rowFilePath);
    if ( rowFile.query_exists(null) ) {
        let [flag, str] = rowFile.load_contents(null);
        if ( flag ) {
            let rows = parseInt(str);
            if ( !isNaN(rows) && rows > 0 && rows < 6 ) {
                nrows = rows;
            }
        }
    }

    origShowTray = MessageTray.MessageTray.prototype._showTray;
    myShowTray = function() {
        let h = bottomPanel.actor.get_theme_node().get_height();
        this._tween(this.actor, '_trayState', MessageTray.State.SHOWN,
                    { y: - this.actor.height - h,
                      time: MessageTray.ANIMATION_TIME,
                      transition: 'easeOutQuad'
                    });
    };

    MessageTray.MessageTray.prototype.toggleState = function() {
        if (this._summaryState == MessageTray.State.SHOWN) {
            this._pointerInSummary = false;
        }
        else {
            this._pointerInSummary = true;
        }
        this._updateState();
    };

    origShowWorkspaceSwitcher =
        WindowManager.WindowManager.prototype._showWorkspaceSwitcher;

    myShowWorkspaceSwitcher = function(shellwm, binding, window, backwards) {
        if (global.screen.n_workspaces == 1)
            return;

        if (this._workspaceSwitcherPopup == null)
            this._workspaceSwitcherPopup = new FripperySwitcherPopup();

        if (binding == 'switch_to_workspace_left')
            this.actionMoveWorkspaceLeft();
        else if (binding == 'switch_to_workspace_right')
            this.actionMoveWorkspaceRight();
        else if (binding == 'switch_to_workspace_up')
            this.actionMoveWorkspaceUp();
        else if (binding == 'switch_to_workspace_down')
            this.actionMoveWorkspaceDown();
    };

    origActionMoveWorkspaceLeft =
        WindowManager.WindowManager.prototype.actionMoveWorkspaceLeft;

    myActionMoveWorkspaceLeft = function() {
        if (Main.overview.visible) {
            return;
        }

        let rtl = (St.Widget.get_default_direction() == St.TextDirection.RTL);
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let indexToActivate = activeWorkspaceIndex;
        let ncols = get_ncols();
        if (rtl && activeWorkspaceIndex < global.screen.n_workspaces-1 &&
                   activeWorkspaceIndex%ncols != ncols-1 )
            indexToActivate++;
        else if (!rtl && activeWorkspaceIndex%ncols > 0)
            indexToActivate--;

        if (indexToActivate != activeWorkspaceIndex)
            global.screen.get_workspace_by_index(indexToActivate).activate(global.get_current_time());

        this._workspaceSwitcherPopup.display(LEFT, indexToActivate);
    };

    origActionMoveWorkspaceRight =
        WindowManager.WindowManager.prototype.actionMoveWorkspaceRight;

    myActionMoveWorkspaceRight = function() {
        if (Main.overview.visible) {
            return;
        }

        let rtl = (St.Widget.get_default_direction() == St.TextDirection.RTL);
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let indexToActivate = activeWorkspaceIndex;
        let ncols = get_ncols();
        if (rtl && activeWorkspaceIndex%ncols > 0)
            indexToActivate--;
        else if (!rtl && activeWorkspaceIndex < global.screen.n_workspaces-1 &&
                         activeWorkspaceIndex%ncols != ncols-1 )
            indexToActivate++;

        if (indexToActivate != activeWorkspaceIndex)
            global.screen.get_workspace_by_index(indexToActivate).activate(global.get_current_time());

        this._workspaceSwitcherPopup.display(RIGHT, indexToActivate);
    };

    origActionMoveWorkspaceUp =
        WindowManager.WindowManager.prototype.actionMoveWorkspaceUp;

    myActionMoveWorkspaceUp = function() {
        if (Main.overview.visible) {
            origActionMoveWorkspaceUp.call(Main.wm);
            return;
        }

        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let indexToActivate = activeWorkspaceIndex;
        let ncols = get_ncols();
        if (activeWorkspaceIndex-ncols >= 0)
            indexToActivate -= ncols;

        if (indexToActivate != activeWorkspaceIndex)
            global.screen.get_workspace_by_index(indexToActivate).activate(global.get_current_time());

        this._workspaceSwitcherPopup.display(UP, indexToActivate);
    };

    origActionMoveWorkspaceDown =
        WindowManager.WindowManager.prototype.actionMoveWorkspaceDown;

    myActionMoveWorkspaceDown = function() {
        if (Main.overview.visible) {
            origActionMoveWorkspaceDown.call(Main.wm);
            return;
        }

        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let indexToActivate = activeWorkspaceIndex;
        let ncols = get_ncols();
        if (activeWorkspaceIndex+ncols < global.screen.n_workspaces)
            indexToActivate += ncols;

        if (indexToActivate != activeWorkspaceIndex)
            global.screen.get_workspace_by_index(indexToActivate).activate(global.get_current_time());

        this._workspaceSwitcherPopup.display(DOWN, indexToActivate);
    };

    WindowManager.WindowManager.prototype._reset = function() {
        this.setKeybindingHandler('switch_to_workspace_left', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_right', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_up', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_down', Lang.bind(this, this._showWorkspaceSwitcher));

        this._workspaceSwitcherPopup = null;
    };
}

let bottomPanel = null;

function enable() {
    MessageTray.MessageTray.prototype._showTray = myShowTray;
    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        myShowWorkspaceSwitcher;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceLeft =
        myActionMoveWorkspaceLeft;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceRight =
        myActionMoveWorkspaceRight;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceUp =
        myActionMoveWorkspaceUp;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceDown =
        myActionMoveWorkspaceDown;

    Main.wm._reset();

    bottomPanel = new BottomPanel();
    bottomPanel.relayout();
}

function disable() {
    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, -1, 1);

    MessageTray.MessageTray.prototype._showTray = origShowTray;
    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        origShowWorkspaceSwitcher;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceLeft =
        origActionMoveWorkspaceLeft;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceRight =
        origActionMoveWorkspaceRight;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceUp =
        origActionMoveWorkspaceUp;
    WindowManager.WindowManager.prototype.actionMoveWorkspaceDown =
        origActionMoveWorkspaceDown;

    Main.wm._reset();

    if ( bottomPanel ) {
        if ( bottomPanel.messageButton.actorAddedId ) {
            Main.messageTray._summary.disconnect(
                bottomPanel.messageButton.actorAddedId);
        }
        if ( bottomPanel.messageButton.actorRemovedId ) {
            Main.messageTray._summary.disconnect(
                bottomPanel.messageButton.actorRemovedId);
        }
        Main.layoutManager.removeChrome(bottomPanel.actor);
        bottomPanel = null;
    }
}
