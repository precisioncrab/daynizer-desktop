# Third-party licenses — bundled sync server (`daynizer-radicale`)

Daynizer's desktop builds bundle a PyInstaller-frozen copy of [Radicale](https://github.com/Kozea/Radicale)
as a **separate executable**, run as a child process and talked to over HTTP/HTTPS on localhost — it is
not linked into the Daynizer binary. Daynizer itself is GPLv3 (see `LICENSE` at the repo root), so this
is a straightforward same-license bundling, not a "different license" compliance question. This file
exists anyway so the corresponding source for every bundled component is easy to find, and so the
non-GPL bundled libraries are properly attributed.

Versions below are what `server/requirements.txt` currently resolves to (pinned as ranges, not exact
versions — the versions actually frozen into a given release can be a newer patch/minor within that
range; check that release's `server/.venv`'s installed versions if you need the exact ones for a
specific build).

| Component | Version (resolved) | License | Source |
|---|---|---|---|
| [Radicale](https://github.com/Kozea/Radicale) | 3.8.0 (range `>=3.5,<4`) | GPLv3 | https://github.com/Kozea/Radicale |
| [libpass](https://github.com/Sythelux/libpass) | 1.9.3 | BSD | https://github.com/Sythelux/libpass |
| [passlib](https://foss.heptapod.net/python-libs/passlib) | 1.7.4 | BSD | https://foss.heptapod.net/python-libs/passlib |
| [bcrypt (Python)](https://github.com/pyca/bcrypt) | 5.0.0 | Apache-2.0 | https://github.com/pyca/bcrypt |
| [vobject](https://github.com/py-vobject/vobject) | 0.9.9 | Apache-2.0 | https://github.com/py-vobject/vobject |
| [defusedxml](https://github.com/tiran/defusedxml) | 0.7.1 | PSF License | https://github.com/tiran/defusedxml |
| Python runtime (bundled by PyInstaller) | matches `server/README.md`'s freeze-time version (3.12/3.13) | PSF License | https://www.python.org |

Radicale's own GPLv3 text is the same license already shipped with Daynizer (`LICENSE`, and linked from
**Help → About**); the other components above are permissively licensed (BSD/Apache/PSF) and require only
attribution, which this file provides.

**Unmodified upstream.** Daynizer does not patch Radicale or any of the above — `server/radicale.spec`
only adjusts what PyInstaller bundles (hidden imports, excluded test modules), it does not change any
package's source. The corresponding source for the exact GPLv3 component is therefore just the matching
upstream release: https://github.com/Kozea/Radicale/releases

## Scope: the desktop app only

The bundled server (and everything in this file) ships **only in Daynizer desktop** builds. The
Thunderbird add-on does not bundle Radicale, or any part of `server/` — its build
(`vite.config.ts` under `thunderbird-addon/`) only compiles the add-on's own `background/`/`tab/`
scripts plus the shared `src/` UI, and a WebExtension can't spawn an arbitrary native subprocess
binary without a separately-installed native-messaging host regardless, which this project doesn't
have. Keep it that way — see `NEXT.md`'s licensing note for why this boundary matters for the paid
add-on specifically.
