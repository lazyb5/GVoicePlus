<img width="1280" height="640" alt="GVoicePlus banner – Ocean (default)@1x" src="https://github.com/user-attachments/assets/65672bcc-4f87-48ba-a406-0274b3503a1a" />

An unofficial desktop app for Google Voice, with a Mac focus. It keeps Google Voice open in its own window, with a tray/menu bar icon, unread badge, notifications, themes and a few extras.

**GVoicePlus is not affiliated with, endorsed by, or sponsored by Google.** "Google" and "Google Voice" are trademarks of Google LLC. You sign in with your own Google account, and the app loads the normal Google Voice website.

This is a fork of [latin-programmer/google-voice-desktop-app](https://github.com/latin-programmer/google-voice-desktop-app), which is itself a fork of the original [Jerrkawz/google-voice-desktop-app](https://github.com/Jerrkawz/google-voice-desktop-app). See [Credits](#credits).

## What it adds

- **Themes:** Material-style colours in Dark and Light, plus the classic themes (Dracula, Solar, Minty, Cerulean, DarkPlus). Pick one in Settings > Appearance.
- **App icon:** 13 colours of one speech-bubble icon, or choose your own image (PNG, JPG or `.icns`). Settings > Appearance.
- **Zoom:** a zoom box in Settings > Appearance. The zoom keys (Cmd/Ctrl +, -, 0) always change the main window, and the box follows them.
- **Top bar:** click a picture of Google Voice's top bar to hide or show its items (menu, logo, search, status, Upgrade, audio, help, settings, apps, account). Settings > Layout.
- **Sidebars:** hide the dialer sidebar, collapse the main sidebar, or collapse it and show it again when you hover. Settings > Layout.
- **Notifications:** reply straight from a notification.
- **Verification codes:** copy a 4 to 8 digit code from a text to the clipboard (without any letters, like the G- in Google codes). For codes of 6 or more digits it also marks the thread read afterwards. Turn on "Copy verification codes" in Settings > General.
- **Updates:** an optional notify-only check ("Tell me about updates"). It tells you when a new release exists and never installs anything.
- **Images:** paste or drag-and-drop images into a message.
- **Also:** start at logon, start minimized to the tray, and spell checking.

## Install (Mac, Apple Silicon)

1. Download the latest `.dmg` or `.zip` from the [Releases page](https://github.com/lazyb5/GVoicePlus/releases).
2. Drag **GVoicePlus** into your Applications folder.
3. The app is not signed with an Apple developer certificate, so macOS will block the first launch. Run this once in Terminal, then open the app:

   ```
   xattr -dr com.apple.quarantine "/Applications/GVoicePlus.app"
   ```

   Or open System Settings > Privacy & Security and click "Open Anyway".

## Platforms

- **macOS (Apple Silicon):** the main target and the best tested.
- **Windows (x64):** works and has been tested in a virtual machine, not yet on a physical PC. Download `GVoicePlus-Setup-<version>-x64.exe` from Releases and run it. The installer is not code signed, so Windows SmartScreen will warn you: click More info, then Run anyway.
- **Linux:** not officially tested, and no download is provided. You can build it yourself (see Run from source). Reply from a notification is not expected to work on Linux, and a tray icon on GNOME may need an AppIndicator extension.

## Settings

Open **GVoicePlus > Settings** in the Mac menu bar (or `File > Settings` on Windows and Linux). The tray icon also opens it.

- **General:** menu bar, start at logon, start minimized, exit on close, spelling, verification codes, update notices.
- **Appearance:** theme, zoom, app icon.
- **Layout:** top bar items and sidebars.

Want to make a theme? See [THEMES.md](THEMES.md).

## Run from source

```
git clone https://github.com/lazyb5/GVoicePlus.git
cd GVoicePlus
npm install
npm start
```

Tests: `npm test`. To build the app yourself: `npm run build:mac` (or `build:windows`, `build:linux`).

## Privacy

Your sign-in and settings are stored on your computer. Besides Google Voice itself, the only network request this fork adds is the optional update check, which asks GitHub for the latest release of this repository.

## Credits

- [Jerrkawz](https://github.com/Jerrkawz/google-voice-desktop-app/), who did almost all of the work on the original app.
- [latin-programmer](https://github.com/latin-programmer/google-voice-desktop-app), who maintains the fork this one is based on.
- Everyone who contributed to those projects.
- Themes: [Dracula](https://github.com/dracula/dracula-theme), [Bootswatch](https://bootswatch.com/) (Solar, Minty, Cerulean), and [M3 Vibrant](https://github.com/luoshenshi/M3-Vibrant) (MIT).

The original project is licensed under ISC (see `package.json`).
