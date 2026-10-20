# Koya Installer

The Koya Shell live CD. It boots straight into the Koya desktop on Hyprland,
signed in to a temporary `live` account, and opens the installer. **Install**
starts the wizard; **Try it out** closes it and leaves you on the desktop.
**Install Koya** in the app launcher opens it again.

Installing downloads current Arch packages and the latest `koya-shell` from the
official Koya repository. Nothing is pinned. The versions that went in are
recorded in `/var/lib/koya-installer/desktop-packages`. The installer sets up
greetd and Hyprland; the theme, wallpaper and desktop configuration come from
the image's profile. The package itself doesn't enable any services.

## Preview

```bash
./run.sh --preview
```

Preview runs the real wizard against a mock layer (`apps/mock.js`): fixture
Wi-Fi networks, four disks (two usable, two refused) and a staged installation
with command output. It never calls the installation backend or touches a
network connection. It starts offline; join **Koya Studio** with the password
`koya-preview`.

| Variable | Effect |
|---|---|
| `KOYA_INSTALLER_MOCK_ONLINE=1` | Start with a wired connection |
| `KOYA_INSTALLER_MOCK_FAIL=<stage>` | Stop the installation at that stage (e.g. `packages`) |
| `KOYA_INSTALLER_MOCK_SPEED=<n>` | Speed the installation up (e.g. `4`) |
| `KOYA_INSTALLER_MOCK_WIFI=none` | A computer without a Wi-Fi device |
| `KOYA_INSTALLER_MOCK_CABLE=<s>` | Plug a network cable in after `s` seconds |

Preview needs Koya 0.7.1 or newer installed, with its shared assets and
matching `process` and `dbus` plugins.

## The wizard

After the welcome screen: connect to a network, choose a disk, choose
encryption and optional apps, set the disk passphrase (only when encrypting),
create the account, then review. Encryption and every optional app are on by
default.

The timezone comes from the system's zone tables (`backend/timezones.sh`).
Search by city, country, region or common name (`syd`, `germany`, `uk`). Each
match shows the time there and its offset; Enter takes the top one.

The review names the disk that will be erased, and **Erase and install** is the
confirmation. The whole disk is used: a 512 MiB EFI partition and an ext4 root.
There's no manual partitioning or dual boot, and the kernel and filesystem are
fixed.

During installation the wizard shows each stage by name, with the command output
underneath on request. Navigation is locked once it starts. A failure stops the
job and cleans up the installer's own mounts and mapping. It doesn't restore
anything that was erased. If the window closes unexpectedly, the worker loses
its pipes, fails at its next write and cleans up the same way.

## Build the image

On an up-to-date x86_64 Arch Linux machine, install the build tools and run the
build as root:

```bash
pacman -S --needed archiso archlinux-keyring
./build-image.sh
```

That produces `dist/koya-installer-VERSION-x86_64.iso`, its SHA-256 checksum and
a list of the live image's package versions. Set `KOYA_IMAGE_VERSION` to give a
release its own version; an optional argument sets the output directory. Allow
about 12 GiB of space and an internet connection. Each build starts in a fresh
`.work/image.*` directory and leaves it there to inspect.

`./build-image.sh --prepare-only` assembles and verifies the profile as an
ordinary user, without Archiso. It needs GnuPG and the usual shell tools. The
full build needs Archiso 91 or newer.

Every build downloads current Arch packages and Koya packages from the official
repository. The installed system uses the same repository for Koya and its
plugins. Nothing depends on a particular USB stick, partition UUIDs or a home
directory. Koya packages and repository metadata are checked against the pinned
signing key, using a keyring of the build's own. The live system runs from a
compressed filesystem with a temporary writable overlay, so Wi-Fi passwords and
anything else changed in the live session are gone at shutdown.

## GitHub builds and releases

`.github/workflows/release.yml` runs on every push to `master`, or by hand from
the Actions tab. It runs `npm test`, builds the ISO in a privileged Arch Linux
container on an Ubuntu runner, checks the release files and publishes a release
on the exact commit. The build job has read-only access to the repository; only
the publishing job can create releases. It uses the built-in `GITHUB_TOKEN`, so
no secrets are needed unless your organisation restricts workflow permissions.

Release tags look like `live-2026.10.20-12.1-abcdef0`: the UTC date, run number,
attempt and short commit. A rerun gets a new version. Each release has the ISO,
its checksum and the package list. [GitHub caps release assets at 2 GiB](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas), so an
ISO over 1900 MiB is uploaded in numbered parts, with instructions and checksums
for putting it back together. Build artifacts stay in Actions for seven days.
A release only goes out after a successful build, but nothing boots the ISO or
runs the graphical preview.

## Write and boot

Any USB stick big enough for the image will do. Unmount its partitions, then
write the image to the **whole device**. Replace `/dev/sdX` with the stick; this
erases it:

```bash
cd dist
sha256sum -c koya-installer-VERSION-x86_64.iso.sha256
dd if=koya-installer-VERSION-x86_64.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

A graphical image writer works too. Spare space on a bigger stick goes unused.
Boot an x86_64 UEFI computer with Secure Boot off; legacy BIOS isn't supported.

Installing needs the internet, because the packages come from Arch and Koya's
signed repository at install time. The Wi-Fi connection you choose is for the
live session only; the installed desktop keeps its own saved connections.

## The live desktop

The live desktop has Firefox, Files, a terminal, audio controls and screenshot
tools, with the same theme, wallpaper and shell as an installed system. The
account is `live`, password `live`, with passwordless sudo. Idle locking is off.

The installer is an ordinary application. It starts the root backend through
polkit when installation begins, and only the active local live account is
authorised to do that without a password. Closing it leaves the desktop running.

To debug, switch to another VT and log in as `root` with no password. SSH isn't
enabled. Logs:

- desktop startup: `journalctl -u greetd -u koya-live-setup`
- installer: `journalctl -t koya-installer`
- wallpaper preparation: `/var/log/koya-live/wallpaper.log`

## The installed desktop

An installed system gets the theme, the chosen wallpaper, the greeter, the lock
screen and GUI authentication. Pacman owns the shell under
`/usr/share/koya-shell`. The optional apps are Firefox, Files, advanced audio
controls and screenshot tools; shortcuts for any left out are removed. Root
login is locked, and the new account can use sudo.

## Command line and development

The GUI and the command line share one modular Bash backend. The GUI talks to it
in bounded JSON lines over private pipes. Credentials never go into argv,
environment variables, temporary files or diagnostic output, and no shell
command is built from user input. The backend checks the disk's identity and
whether it's mounted or the boot source immediately before erasing it, and only
one installation can run at a time.

```bash
./install.sh /dev/TARGET --plan
./install.sh /dev/TARGET --user user --hostname koya
./install.sh /dev/TARGET --no-encryption --apps firefox,files
npm test
./run.sh --preview --self-test
```

The last command drives the real wizard against fixtures and writes screenshots
under `/tmp`. It also checks that moving to the installation page keeps the
window's resolution and scale. To test a window resize after installation as
well, run `KOYA_INSTALLER_PREVIEW_RESIZE=1 ./run.sh --preview --self-test`.

`tests/vm-install.sh` runs the real backend. It refuses to run anywhere but a
QEMU guest, and it erases that guest's `/dev/vda`.

The installer's UI helpers in `apps/`, and the fonts and icons in `assets/`,
are adapted from Koya Bar. No shell, desktop apps or greeter are bundled for the
UI. The installed desktop uses the official `koya-shell` package and updates
with `pacman -Syu`; the installer doesn't clone or compile anything.
After editing the profile, run `tools/checksums.mjs` to refresh the payload
checksums.

## Licence

CC BY 4.0. See `LICENSE`, `NOTICE` and `payload/SOURCE.txt` for attribution and
third-party notices.
