#!/bin/bash
desktop_step() {
  stage desktop 'Configuring the desktop and greeter'
  mkdir -p "$mnt/home/$username/.config" "$mnt/home/$username/.local/share/koya-bar/wallpapers"
  cp -a "$payload/profile/config/." "$mnt/home/$username/.config/"
  cp -a "$payload/profile/wallpapers/." "$mnt/home/$username/.local/share/koya-bar/wallpapers/"
  local hypr=$mnt/home/$username/.config/hypr/hyprland.lua
  if ! jq -e 'index("firefox")' <<< "$apps" >/dev/null; then sed -i '\|hl.bind(mainMod .. " + B",|d' "$hypr"; fi
  if ! jq -e 'index("files")' <<< "$apps" >/dev/null; then sed -i '\|hl.bind(mainMod .. " + E",|d' "$hypr"; fi
  if ! jq -e 'index("screenshots")' <<< "$apps" >/dev/null; then sed -i '\|hl.bind("Print",|d' "$hypr"; fi
  arch-chroot "$mnt" chown -R "$username:$username" "/home/$username"
  configure_greeter
  stage wallpaper 'Preparing the theme and login wallpaper'
  install -m 644 "$payload/prepare-wallpaper.js" "$mnt/var/lib/koya-installer/koya-prepare-wallpaper.js"
  timeout -k 2 60 arch-chroot "$mnt" runuser -u "$username" -- env -u DISPLAY -u WAYLAND_DISPLAY \
    /usr/bin/koya -m /usr/share/koya/assets -m /var/lib/koya-installer -n /usr/lib/koya-shell -i koya-prepare-wallpaper.js > "$mnt/var/lib/koya-installer/wallpaper.log" 2>&1
  if ! grep -q KOYA_WALLPAPER_READY "$mnt/var/lib/koya-installer/wallpaper.log"; then cat "$mnt/var/lib/koya-installer/wallpaper.log" >&2; die 'Wallpaper cache could not be prepared'; fi
  install -d -m 700 "$mnt/var/lib/koya-greeter"
  printf '%s\n' "$username" > "$mnt/var/lib/koya-greeter/last-user"
}

configure_greeter() {
  install -d -m 755 "$mnt/etc/greetd" "$mnt/etc/koya-greeter" "$mnt/etc/systemd/system/greetd.service.d" "$mnt/usr/local/libexec" "$mnt/usr/share/polkit-1/actions"
  install -m 644 "$payload/greeter/config.toml" "$mnt/etc/greetd/config.toml"
  install -m 644 "$payload/greeter/greetd-koya.conf" "$mnt/etc/systemd/system/greetd.service.d/koya.conf"
  install -m 644 "$payload/greeter/org.koya.greeter.policy" "$mnt/usr/share/polkit-1/actions/org.koya.greeter.policy"
  install -m 755 "$payload/greeter/koya-greetd" "$payload/greeter/koya-greeter-autologin" "$mnt/usr/local/libexec/"
  systemctl --root="$mnt" enable greetd.service
}
