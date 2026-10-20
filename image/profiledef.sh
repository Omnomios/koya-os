#!/bin/bash
iso_name="koya-installer"
iso_label="KOYA_INSTALL"
iso_publisher="Koya <https://www.koya-ui.com>"
iso_application="Koya live desktop and installer"
iso_version="@VERSION@"
install_dir="koya"
arch="x86_64"
bootmodes=('uefi.systemd-boot')
pacman_conf="pacman.conf"
airootfs_image_type="squashfs"
airootfs_image_tool_options=('-comp' 'zstd' '-Xcompression-level' '6' '-b' '1M')
file_permissions=(["/etc/shadow"]="0:0:400")
