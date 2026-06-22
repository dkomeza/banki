# Banki

Banki is a private, deadline-aware spaced-repetition web app. It uses FSRS 6 for memory-state scheduling and a constrained planner that ranks cards by expected recall gain per study second.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The SQLite database is created at `data/banki.db`; imported media is stored under `public/media`.

For an isolated persistent installation:

```bash
docker compose up --build
```

Docker Compose persists the database and media in named volumes.

## Features

- FSRS 6 scheduling with four answer grades and optional personal parameter optimization after 400 reviews.
- Deadline plans based on a deck, target date, and daily minute budget.
- `.apkg` import for legacy `collection.anki2`/`collection.anki21` and modern zstd/protobuf `collection.anki21b` packages.
- Versioned `.banki.json` import for fast, atomic import of LLM-generated cards. See the [study-card format](docs/STUDY_CARD_FORMAT.md).
- Basic, reversed, conditional, and cloze template materialization with imported scheduling intentionally reset.
- Local MathJax 3 rendering for `\(...\)`, `\[...\]`, AMS expressions, `mhchem`, legacy Anki math tags, and Unicode math symbols.
- Responsive keyboard and touch study flow, basic card creation, forecasts, and local statistics.
- Optional written-answer mode with server-side LLM grading and learner-confirmed FSRS ratings.

Complex Anki templates that depend on JavaScript or unsupported filters are reported during import and are never executed.

## Commands

```bash
npm test          # unit and import integration tests
npm run lint      # ESLint
npm run build     # production build
npm run db:push   # reconcile schema with an existing database
```

Configuration is documented in `.env.example`. The default study timezone is `Europe/Warsaw`.
Written-answer grading can use OpenAI or OpenRouter and is configured on the Settings page. `OPENAI_API_KEY`, `OPENAI_GRADING_MODEL`, `OPENROUTER_API_KEY`, and `OPENROUTER_GRADING_MODEL` remain available as deployment-level fallbacks. Unlike the rest of the study flow, answers submitted in this mode are sent to the selected provider for grading.
