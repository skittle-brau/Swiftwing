# Synergetic test pack

These files show what Synergetic keeps, strips or rewrites when HTML is pasted
into it. Each test case has a visible label (T1.1, T3.30 …) so dropped cases are
easy to spot, both by eye and with the comparison script.

| File | What it tests |
|---|---|
| `01-document-head.html` | Doctype, `<html>` attributes, `<meta>` tags, `<title>`, `<style>` block, media query, Outlook-only `<style>`, body attributes, hidden preheader |
| `02-layout-tables.html` | Table/cell attributes (`cellpadding`, `bgcolor`, `valign`…), `role`, `id`/`class`, `dir="rtl"`, `colspan`/`rowspan`/`thead`/`th`, nested tables, background images, Outlook ghost table |
| `03-inline-css.html` | 43 inline CSS properties and formats: colours, fonts, sizes, spacing, borders, `border-radius`, `display`, `mso-*`, `!important`, shorthands, upper-case names |
| `04-text-elements.html` | Headings, `<br>` vs `<br />`, bold/italic/underline/strike, `sup`/`sub`, `font`, `center`, `blockquote`, `pre`/`code`, lists, `hr`, `title`/`dir`/`lang` attributes, empty paragraphs, `&nbsp;` |
| `05-images-and-links.html` | Image attributes, linked images, relative and `data:` images, `srcset`; links with query strings, `mailto`, `tel`, anchors, `target`/`rel`, `javascript:`, placeholders in URLs, a table button |
| `06-characters.html` | Named, numeric and raw characters (accents, macrons, emoji, curly quotes), `&nbsp;`, bare `&`, and eight merge-field styles |
| `07-comments-and-outlook.html` | Plain comments, `[if mso]` / `[if !mso]` / `[if gte mso 9]`, ghost-table columns, a VML button |
| `10-swiftwing-export-html4.html` | A full Swiftwing export (one of every block) as HTML 4.01 Transitional |
| `11-swiftwing-export-xhtml.html` | The same email as XHTML 1.0 Transitional |
| `12-swiftwing-export-html5.html` | The same email as HTML5 |

All files are valid HTML 4.01 apart from three deliberate cases: a bare `&`
in a link (T5.10) and in text (T6.8), and an old-style `<a name="…" id="…">`
anchor (T5.13). They're there to see whether Synergetic corrects them.

Images point at `email.example.org`, so they show as broken. That's expected:
the tests are about the code. To regenerate 10–12 (for example after new
blocks are added, or with your own image address), run
`npm run synergetic-tests` (optionally `-- --base-url https://your.domain`).

## How to run a test

For each file:

1. In Synergetic, create a new email and switch the editor to its HTML or
   source view.
2. Open the test file in a text editor, copy **everything**, and paste it in,
   replacing whatever is there.
3. Save the email. Close it, open it again, and switch back to the HTML/source
   view.
4. Copy everything Synergetic now shows and save it next to the original as
   `NN-name.after.html`, e.g. `03-inline-css.after.html`.
5. Optional but useful: send the email to yourself and look at it in Outlook
   desktop and on a phone. Note which labelled lines look wrong.

If Synergetic has more than one place HTML goes in (a template editor, a
communication editor, an "import HTML" option), note which one you used. They
may behave differently.

## Comparing

```bash
npm run synergetic-compare -- docs/synergetic-tests
```

This compares every `NN-name.html` that has an `NN-name.after.html` next to it,
and lists only what changed:
- the doctype
- test labels that disappeared
- elements, attributes and inline CSS properties and values
- comments and Outlook conditionals
- `<style>` blocks and media queries
- how characters are encoded
- self-closing tags

To compare two files directly:

```bash
npm run synergetic-compare -- before.html after.html
```

Send the `.after.html` files (or the comparison output) back. Each finding
becomes a rule in `SYNERGETIC_RULES` in `server/lib/exporter.js`, applied when
**Synergetic compatibility** is ticked under Export in Email settings.
