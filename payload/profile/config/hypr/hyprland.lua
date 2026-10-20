-- ~/.config/hypr/hyprland.lua
-- Hyprland Lua configuration (0.55 or newer).

----------------
-- PROGRAMS
----------------

local terminal = "kitty"
local fileManager = "nautilus"
hl.env("KOYA_PAM_SERVICE", "login")
hl.env("SUDO_ASKPASS", "/usr/lib/koya-shell/koya-askpass")
hl.env("SSH_ASKPASS", "/usr/lib/koya-shell/koya-askpass")
hl.env("KOYA_SSH_UPSTREAM", os.getenv("XDG_RUNTIME_DIR") .. "/ssh-agent.socket")
hl.env("SSH_AUTH_SOCK", os.getenv("XDG_RUNTIME_DIR") .. "/koya-ssh/agent.sock")
local menu = "/usr/bin/koya-launcher"
local browser = "firefox"
local lockScreen = "/usr/bin/koya-lock"
local sshAgent = "/usr/bin/koya-ssh-add"

----------------
-- AUTOSTART
----------------

-- hl.exec_cmd() is async, so no trailing & is needed.
hl.on("hyprland.start", function()
  -- Koya owns the status bar, wallpaper and notification service.
  hl.exec_cmd("/usr/bin/koya-shell")
  hl.exec_cmd("hypridle")


  -- GTK / libadwaita dark mode.
  hl.exec_cmd([[gsettings set org.gnome.desktop.interface color-scheme "prefer-dark"]])
  hl.exec_cmd([[gsettings set org.gnome.desktop.interface gtk-theme "adw-gtk3"]])
end)

----------------
-- ENVIRONMENT
----------------

hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("GTK_THEME", "Adwaita-dark")

----------------
-- PERMISSIONS
----------------

-- Permission changes require a Hyprland restart. Disabled by default.

-- hl.config({
--   ecosystem = {
--     enforce_permissions = true,
--   },
-- })

-- hl.permission("/usr/(bin|local/bin)/grim", "screencopy", "allow")
-- hl.permission("/usr/(lib|libexec|lib64)/xdg-desktop-portal-hyprland", "screencopy", "allow")
-- hl.permission("/usr/(bin|local/bin)/hyprpm", "plugin", "allow")

----------------
-- LOOK AND FEEL
----------------

hl.config({
  general = {
    gaps_in = 2,
    gaps_out = 3,

    border_size = 0,

    col = {
      active_border = "rgba(595959ee)",
      inactive_border = "rgba(595959aa)",
    },

    resize_on_border = true,
    allow_tearing = false,

    layout = "dwindle",
  },

  decoration = {
    rounding = 5,
    rounding_power = 2,

    active_opacity = 1.0,
    inactive_opacity = 0.5,

    shadow = {
      enabled = true,
      range = 4,
      render_power = 3,
      color = "rgba(1a1a1aee)",
    },

    blur = {
      enabled = true,
      size = 5,
      passes = 2,
      vibrancy = 0.1696,
    },
  },

  animations = {
    enabled = true,
  },

  dwindle = {
    preserve_split = true,
  },

  master = {
    new_status = "master",
  },

  misc = {
    force_default_wallpaper = 0,
    disable_hyprland_logo = true,
  },

  input = {
    kb_layout = "us",
    kb_variant = "",
    kb_model = "",
    kb_options = "",
    kb_rules = "",

    follow_mouse = 1,

    sensitivity = 0,

    touchpad = {
      natural_scroll = true,
    },
  },
})

----------------
-- ANIMATIONS
----------------

hl.curve("easeOutQuint", {
  type = "bezier",
  points = { { 0.23, 1 }, { 0.32, 1 } },
})

hl.curve("easeInOutCubic", {
  type = "bezier",
  points = { { 0.65, 0.05 }, { 0.36, 1 } },
})

hl.curve("linear", {
  type = "bezier",
  points = { { 0, 0 }, { 1, 1 } },
})

hl.curve("almostLinear", {
  type = "bezier",
  points = { { 0.5, 0.5 }, { 0.75, 1.0 } },
})

hl.curve("quick", {
  type = "bezier",
  points = { { 0.15, 0 }, { 0.1, 1 } },
})

hl.animation({ leaf = "global", enabled = true, speed = 10, bezier = "default" })
hl.animation({ leaf = "border", enabled = true, speed = 5.39, bezier = "easeOutQuint" })

hl.animation({ leaf = "windows", enabled = true, speed = 4.79, bezier = "easeOutQuint" })
hl.animation({ leaf = "windowsIn", enabled = true, speed = 4.1, bezier = "easeOutQuint", style = "popin 87%" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 1.49, bezier = "linear", style = "popin 87%" })

hl.animation({ leaf = "fadeIn", enabled = true, speed = 1.73, bezier = "almostLinear" })
hl.animation({ leaf = "fadeOut", enabled = true, speed = 1.46, bezier = "almostLinear" })
hl.animation({ leaf = "fade", enabled = true, speed = 3.03, bezier = "quick" })

hl.animation({ leaf = "layers", enabled = true, speed = 3.81, bezier = "easeOutQuint" })
hl.animation({ leaf = "layersIn", enabled = true, speed = 4, bezier = "easeOutQuint", style = "fade" })
hl.animation({ leaf = "layersOut", enabled = true, speed = 1.5, bezier = "linear", style = "fade" })

hl.animation({ leaf = "fadeLayersIn", enabled = true, speed = 1.79, bezier = "almostLinear" })
hl.animation({ leaf = "fadeLayersOut", enabled = true, speed = 1.39, bezier = "almostLinear" })

hl.animation({ leaf = "workspaces", enabled = true, speed = 1.94, bezier = "almostLinear", style = "fade" })
hl.animation({ leaf = "workspacesIn", enabled = true, speed = 1.21, bezier = "almostLinear", style = "fade" })
hl.animation({ leaf = "workspacesOut", enabled = true, speed = 1.94, bezier = "almostLinear", style = "fade" })

----------------
-- OPTIONAL SMART GAPS
----------------

-- "Smart gaps" / "No gaps when only". Disabled by default.

-- hl.workspace_rule({ workspace = "w[tv1]", gaps_out = 0, gaps_in = 0 })
-- hl.workspace_rule({ workspace = "f[1]", gaps_out = 0, gaps_in = 0 })

-- hl.window_rule({
--   name = "no-gaps-wtv1",
--   match = {
--     float = false,
--     workspace = "w[tv1]",
--   },
--   border_size = 0,
--   rounding = 0,
-- })

-- hl.window_rule({
--   name = "no-gaps-f1",
--   match = {
--     float = false,
--     workspace = "f[1]",
--   },
--   border_size = 0,
--   rounding = 0,
-- })

----------------
-- KEYBINDINGS
----------------

local mainMod = "SUPER"

-- Apps / session.
hl.bind(mainMod .. " + Q", hl.dsp.exec_cmd(terminal))
hl.bind(mainMod .. " + C", hl.dsp.window.close())
hl.bind(mainMod .. " + M", hl.dsp.exit())

hl.bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager))
hl.bind(mainMod .. " + B", hl.dsp.exec_cmd(browser))
hl.bind(mainMod .. " + V", hl.dsp.window.float({ action = "toggle" }))
hl.bind(mainMod .. " + R", hl.dsp.exec_cmd(menu))
hl.bind(mainMod .. " + L", hl.dsp.exec_cmd(lockScreen))
hl.bind(mainMod .. " + U", hl.dsp.exec_cmd(sshAgent))

-- Dwindle.
hl.bind(mainMod .. " + P", hl.dsp.window.pseudo())
hl.bind(mainMod .. " + J", hl.dsp.layout("togglesplit"))

-- Move focus with mainMod + arrow keys.
hl.bind(mainMod .. " + left", hl.dsp.focus({ direction = "left" }))
hl.bind(mainMod .. " + right", hl.dsp.focus({ direction = "right" }))
hl.bind(mainMod .. " + up", hl.dsp.focus({ direction = "up" }))
hl.bind(mainMod .. " + down", hl.dsp.focus({ direction = "down" }))

-- Switch workspaces with mainMod + [0-9].
-- Move active window with mainMod + SHIFT + [0-9].
for i = 1, 10 do
  local key = i % 10 -- 10 maps to key 0

  hl.bind(mainMod .. " + " .. key, hl.dsp.focus({ workspace = i }))
  hl.bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ workspace = i }))
end

-- Special workspace / scratchpad.
hl.bind(mainMod .. " + S", hl.dsp.workspace.toggle_special("magic"))
hl.bind(mainMod .. " + SHIFT + S", hl.dsp.window.move({ workspace = "special:magic" }))

-- Scroll through existing workspaces.
hl.bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(mainMod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }))

-- Move/resize windows with mainMod + LMB/RMB and dragging.
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true })

-- Screenshot.
hl.bind("Print", hl.dsp.exec_cmd([[grim -g "$(slurp)" - | swappy -f -]]))

-- Laptop multimedia keys for volume and LCD brightness.
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"), {
  locked = true,
  repeating = true,
})

hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"), {
  locked = true,
  repeating = true,
})

hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), {
  locked = true,
  repeating = true,
})

hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"), {
  locked = true,
  repeating = true,
})

hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%+"), {
  locked = true,
  repeating = true,
})

hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%-"), {
  locked = true,
  repeating = true,
})

-- Requires playerctl.
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), {
  locked = true,
})

hl.bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), {
  locked = true,
})

hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), {
  locked = true,
})

hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), {
  locked = true,
})

----------------
-- WINDOWS AND WORKSPACES
----------------

-- Float pavucontrol.
hl.window_rule({
  name = "float-pavucontrol",
  match = {
    class = "^(org.pulseaudio.pavucontrol)$",
  },
  float = true,
})

-- Float Koya windows.
hl.window_rule({
  name = "float-koya-window",
  match = {
    class = "^(koya-window)$",
  },
  float = true,
})

-- Float the desktop portal's file chooser (Koya Settings opens it to add
-- wallpapers) instead of tiling it.
hl.window_rule({
  name = "float-portal-file-chooser",
  match = {
    class = "^(xdg-desktop-portal-gtk)$",
  },
  float = true,
})

-- Fix some dragging issues with XWayland.
hl.window_rule({
  name = "fix-xwayland-empty-class-drags",
  match = {
    xwayland = true,
    class = "^$",
    title = "^$",
    float = true,
    fullscreen = false,
    pin = false,
  },
  no_focus = true,
})
