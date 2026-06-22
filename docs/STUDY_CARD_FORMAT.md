# Banki study-card format (version 1)

Use this format to generate and import a deck without creating an Anki package.
Save the result as a UTF-8 file whose name ends in `.banki.json`, then select it
in Banki's **Import study cards** panel.

## Copy-ready example

```json
{
  "version": 1,
  "deck": {
    "name": "Cell biology",
    "description": "Core concepts for the first exam"
  },
  "cards": [
    {
      "front": "What is the main function of mitochondria?",
      "back": "They produce ATP through cellular respiration.",
      "tags": ["biology", "organelles"]
    },
    {
      "front": "State the equation for aerobic respiration.",
      "back": "\\[C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O + energy\\]",
      "tags": ["biology", "equations"]
    }
  ]
}
```

## Instructions for LLMs

Return only one valid JSON object. Do not wrap it in a Markdown code fence and do
not add commentary before or after it.

- Use exactly the top-level keys `version`, `deck`, and `cards`.
- Set `version` to the number `1`, not the string `"1"`.
- `deck.name` is required. `deck.description` is optional.
- Create one object per card with required string fields `front` and `back`.
- `tags` is optional. When present, it must be an array of short strings.
- Do not add fields not described here.
- Emit valid JSON: use double quotes, no trailing commas, and escape newlines,
  quotes, and backslashes inside strings.
- For inline math, put LaTeX inside `\\(...\\)`. For display math, use
  `\\[...\\]`. Because this is JSON, each LaTeX backslash must be written as
  `\\` in the file.
- Basic safe HTML is allowed in `front` and `back`, including paragraphs, lists,
  tables, emphasis, code, and links. Plain text is preferred when HTML adds no
  value. Scripts and unsafe markup are removed during import.
- Each card must stand on its own. Keep the front focused on one recall prompt and
  the back concise enough to grade without hidden context.
- Do not generate duplicate or near-duplicate cards. Put categories in `tags`,
  not in the question text.

## Limits and behavior

| Field | Requirement |
| --- | --- |
| `deck.name` | 1–120 characters |
| `deck.description` | 0–2,000 characters |
| `cards` | 1–10,000 cards |
| `front`, `back` | 1–100,000 characters each |
| `tags` | At most 40 per card |
| each tag | 1–50 characters |
| file size | At most 20 MB |

Import is atomic: if the JSON or any card is invalid, Banki imports nothing. Card
order is preserved, duplicate tags on a card are collapsed, HTML is sanitized,
and scheduling starts from a clean state. Version 1 does not embed media; use
HTTPS image or audio URLs in safe HTML, or import an `.apkg` when local media must
be bundled.

## JSON Schema

Machine-readable validation is available in
[`banki-card-format.schema.json`](./banki-card-format.schema.json).
