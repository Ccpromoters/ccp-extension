# Installing CCP Extension manually

Until the Chrome Web Store listing is approved, install the extension from the release zip. Works in Chrome, Edge and Brave (Chrome 116 or newer).

## 1. Get the files

- Go to https://github.com/Ccpromoters/ccp-extension/releases and download `ccp-extension-vX.Y.Z.zip`.
- Unzip it somewhere permanent (for example `Documents\CCP Extension`). Chrome loads the extension from this folder every time it starts, so do not delete or move it later.

## 2. Load it in Chrome

1. Open a new tab and go to `chrome://extensions`.
2. Switch on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the unzipped folder – the one that directly contains `manifest.json`.
5. The settings page opens. Fill in the candidate name, upload the master resume (.docx) and paste the AI key (see [README → Set up](../README.md#set-up-2-minutes)).

## 3. Pin it

Click the puzzle-piece icon in the Chrome toolbar and pin **CCP Extension**. Clicking the icon opens the side panel; `Alt+Shift+C` does the same. Right-clicking the icon gives *Open job boards* and *Settings*.

## Several candidates on one computer

Create one Chrome profile per candidate (Chrome menu → profile icon → *Add*). Sign that profile in to the candidate's LinkedIn, Indeed, Gmail and so on, then repeat steps 2–3 inside that profile. Each profile keeps its own settings, master resume, tracker and inbox. Settings → *Backup* exports and imports a profile setup as a JSON file.

## Updating

Download the new zip, unzip it over the same folder (replace all files), then click the refresh icon on the extension's card at `chrome://extensions`. Settings and data are kept.

## Uninstalling

`chrome://extensions` → *Remove*. All data stored by the extension is deleted with it.
