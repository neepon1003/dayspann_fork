# Changelog

All notable changes to dayspann will be documented in this file.

## 1.0.0

- Prepare the tested core feature set for submission to the Obsidian Community Plugins directory.
- Confirm use on macOS, Windows, and iPhone through public beta testing.
- Keep dayspann fully local and offline, without external services, telemetry, or advertisements.

## 0.1.8

- Archive entries without deleting their Markdown files or source-note links.
- Keep archived entries out of the future, today, and past sections.
- Show archived entries in a separate, collapsed section and let users restore them to the main list.
- Preserve archive state and the archive section's collapsed state across refreshes and restarts.

## 0.1.7

- Standardize the display name as lowercase `dayspann`.
- Change the internal plugin ID, installation folder, view ID, CSS namespace, and new record type to `dayspann` before community testing.
- Use `dayspann` as the default record folder while retaining read compatibility with pre-0.1.7 beta records.
- Automatically rename the former default `Dayspan` record folder and update legacy `type: dayspan` records after upgrading.

## 0.1.6

- Replace the functional list-view tagline with the concept-led dayspann tagline.
- Use “日々の中から、記念日をすくい上げる。” in Japanese and “Uncover the days worth remembering.” in English.

## 0.1.5

- Rename the public-facing plugin from Dayspan to dayspann.
- Preserve the former internal plugin ID and support existing `Dayspan` record folders and `type: dayspan` records.
- Use `dayspann` and `type: dayspann` for new record folders and records.
- Update documentation and BRAT instructions for the renamed GitHub repository.

## 0.1.4

- Open the dayspann record before normalizing its source-note link.
- Prevent card clicks from propagating to other note-opening handlers.

## 0.1.3

- Open the saved dayspann record whenever a date card is selected.
- Store the source note as a clickable Obsidian link in records created from selected text.
- Let existing and manually created records choose, change, or remove a source note from the edit dialog.
- Add BRAT installation instructions for public beta testing.

## 0.1.2

- Let each date section be expanded or collapsed from its heading.
- Remember collapsed sections after refreshing or restarting Obsidian.
- Add accessible Japanese and English labels and keyboard operation to section controls.

## 0.1.1

- Add Japanese and English interfaces based on the Obsidian display language.
- Localize dates and day, month, and year units, including English plural forms.
- Generalize the empty-state guidance from journal text to text in any Markdown note.
- Keep the header tagline readable across desktop, narrow panes, and mobile layouts.

## 0.1.0

- Register selected Markdown text or add records manually.
- Group records by future, today, and past dates.
- Display spans as days, months, years, months and days, or years, months and days.
- Customize section order and past/future colors.
- Save records as local Markdown files and link back to source notes.
- Support desktop and mobile layouts.
