# dayspann

[English](README.md) | [日本語](README.ja.md)

Pan through your days and lift out meaningful anniversaries like gold with Obsidian.

dayspann is built on the belief that life becomes richer as you uncover and gather more anniversaries of your own.

dayspann lets you choose meaningful dates from your past records or future plans. It then connects each chosen date to today, making the span between them visible: how much time has passed, or how much remains. From that span, your own Story can emerge.

dayspann does not automatically analyze your vault. You choose what becomes an anniversary.

> [!NOTE]
> dayspann can be installed through GitHub and BRAT. Once it appears in the Obsidian Community Plugins directory, it can also be installed and updated directly from Obsidian.
> The interface follows Obsidian's display language in Japanese and English, with English used as the fallback for other languages.
> See the [beta testing guide](BETA_TESTING.md) for installation, checks, and reporting.

## Features

- Register selected text from Markdown editing or reading view.
- Add milestones and future dates manually.
- Automatically group records into **Days remaining**, **Today**, and **Days elapsed** sections.
- Choose a display format for each record:
  - Days
  - Months
  - Years
  - Months and days
  - Years, months, and days
- Reorder the three sections.
- Expand or collapse each section and remember its state.
- Archive entries without deleting them, then restore them to the main list when needed.
- Customize colors for future and past records.
- Keep a clickable link to the original source note in each saved record.
- Store every record as a readable Markdown file in your vault.
- Use the plugin on desktop and mobile.

Month and year calculations use calendar boundaries rather than fixed 30-day or 365-day approximations.

## Usage

1. Select text in a Markdown note.
2. Open the Command palette and run **Add selected text**. In editing view, you can also use **Add to dayspann** from the context menu.
3. Confirm the title, reference date, and display format.
4. Open dayspann from the ribbon calendar icon or run **Open list** from the Command palette.

Select a card to open its saved dayspann record. If it was created from selected text, the `source` property contains a clickable link to the original note. You can also open the source note directly from the card's actions menu.

You can also use **Add manually** to add birthdays, age milestones, anniversaries, or future deadlines without selecting text. From the edit dialog, you can choose or remove a source note for any existing record.

## Data and privacy

dayspann works locally and offline.

- It does not connect to external services.
- It does not collect telemetry or analytics.
- It does not display advertisements.
- It does not modify the selected source note.
- It stores records as Markdown files inside the vault.
- It stores plugin preferences in Obsidian's standard plugin data file.

The default record folder for new installations is `dayspann`. You can change it in the plugin settings.

## Name

`dayspann` begins with the philosophy of **days + pann(ing)**: panning through many days to lift out meaningful anniversaries like gold, gathering more of them as your own, and enriching your life. The final `n` makes **panning** more visible in the spelling.

As a result, the name also contains **day span**: the span between the chosen date and today. Looking into that span allows your own Story to emerge.

## Installation

### Obsidian Community Plugins

After dayspann appears in the Community Plugins directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for `dayspann`.
3. Choose **Install**, then **Enable**.

Until the listing is available, use BRAT or manual installation below.

### BRAT

1. Install and enable **BRAT** from Obsidian's Community Plugins directory.
2. Open **Settings → BRAT** and choose **Add beta plugin**.
3. Enter `shingotanaka0115/dayspann` as the repository.
4. Enable **dayspann** under **Settings → Community plugins**.

BRAT can check GitHub releases and install later updates. dayspann releases follow semantic versions without a `v` prefix, such as `1.0.0`.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from a GitHub release.
2. Create `<vault>/.obsidian/plugins/dayspann/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **dayspann** under **Settings → Community plugins**.

The internal plugin ID and the manual installation folder are both `dayspann`.

## Development

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Before committing or releasing:

```bash
npm run check
```

Release assets are `main.js`, `manifest.json`, and `styles.css`. Local `data.json` and generated `main.js` are intentionally excluded from source control.

## Contributing

Bug reports and improvement proposals are welcome through GitHub Issues. Please open an issue before starting a substantial change so the direction can be discussed first.

## License

[MIT](LICENSE) © 2026 Shingo Tanaka
