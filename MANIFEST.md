# Banki — Manifest

What the rewrite should do. This is the source of truth for "what's wanted", built up one area at a time.
Anything not written here is undecided. Values marked "proposed" are sensible defaults that can be tuned once the app is in use.

Banki is a self-hosted spaced-repetition app built around **writing answers (typed or handwritten with a stylus) and having an LLM grade them**, with FSRS scheduling, deadline plans and first-class math.

## 1. Decks and cards

- Users can **create, edit and delete decks**.
- Users can **create, edit and delete cards** within a deck.
- **Card type (MVP):** front / back only. No reversed or cloze cards yet.
- **Soft delete** for decks, cards and folders. Reviews of deleted cards **still count** in history and statistics.
- **Recently deleted** view: deleted items can be restored from here, and they are permanently removed automatically after **30 days**.
- **Editing a studied card** offers to reset its progress, but never forces it. The default is to keep the schedule.
- **Folders** organize decks the way a file system does:
  - Folders can be nested. Each deck lives in exactly one folder or at the root.
  - Folders and decks can be created, renamed, moved and deleted. Deleting a folder deletes what's inside it, and everything goes to Recently deleted together.
  - Folders are purely organizational and have **no effect on study or scheduling**. Decks themselves are not nested.
- **Card list per deck** with **search** and **tags**.
- **Cards can be moved** between decks, one at a time or **several at once** (multi-select). A moved card keeps its schedule and history.
- **Editor:** rich text, with **math as the main focus**. It works like Obsidian's live preview:
  - `$…$` is inline math and `$$…$$` is display math (standard LaTeX). Math renders in place once the cursor leaves it and shows its source again when you edit it.
  - A **comprehensive LaTeX cheatsheet** and **autocomplete** for commands (`\frac`, `\sum`, …).
  - **mhchem** for chemistry (`\ce{H2O}`).
  - Formatting: **bold, italic, lists, code blocks, tables**.
  - **Images** can be pasted or dragged in, as well as added with an upload button.
- **Storage format:** card content is stored as **Markdown with LaTeX**, not HTML or editor-specific JSON.
- **Media upload:** users can add **images** to cards from the web UI, up to **5 MB** each. Images used by a soft-deleted card are kept until the card is permanently removed.
- **Duplicate detection:** a card is a duplicate when its **front text matches** another card in the same deck, ignoring case, whitespace and formatting.
  - Adding or editing a card shows a **warning** when the deck already has a duplicate. The user can still save it.
  - Importing into an **existing deck** **skips duplicates automatically** and lists them in the import warnings.
- **Out of scope:** suspending cards and resetting progress outside the edit flow.

## 2. Import and export

- **One format:** Banki's own **versioned JSON** format. JSON leaves room to carry more data later.
  - The format holds **cards only** (front, back, tags, optional grading notes), with no deck name or description fields.
  - Card content is Markdown with LaTeX, the same as in the app.
- **No Anki support:** no `.apkg` import.
- **Import only into an existing deck.** To import a new deck, the user creates the deck first and then imports into it.
  - Import from a **file** (`.json`, or `.zip` with images) or by **pasting JSON** into a text box.
  - A **preview** of the cards comes before every import (see LLM card generation).
  - **Valid cards are imported**; invalid ones are skipped and listed in the report. One bad card doesn't fail the whole file.
  - Duplicates are skipped automatically and listed in the import warnings (see Decks and cards).
  - Limits: **10,000 cards** and **20 MB** per import.
- **Import report** after every import: imported count, skipped duplicates, invalid cards, warnings.
- **Import history:** past imports stay viewable, and an import can be **undone**. Undo soft-deletes exactly the cards that import added.
- **Export** one deck at a time, **cards only** (no progress or history), as a `.zip` containing the JSON and an images folder.
- **Out of scope for now:** full backup and restore (progress, history, everything). It will be a separate feature later.

## 3. LLM card generation

- The app provides a **copyable prompt** for any LLM that produces a valid Banki JSON import.
- The prompt describes the format exactly, including the Markdown and LaTeX rules.
- The prompt builds in **good flashcard practice**: one fact per card, no yes/no questions, short answers.
- The prompt asks the LLM to write **grading notes** for cards where the answer has key elements or can be phrased in several ways.
- **Customizable prompt:** card language, number of cards, difficulty, and free-form extra instructions. The options are **remembered** between uses.
- A **JSON Schema** of the format is published next to the prompt, for LLMs and APIs that support structured outputs.
- **Import preview:** before anything is added, every import shows its cards so the user can edit or untick them.
- **Parsing is strict:** no automatic repair of malformed JSON (no stripping code fences, no fixing escapes).
  - Errors are **precise enough to paste back into the LLM**: card number, field and problem (e.g. `card 14, "back": missing`).
- **Later (not MVP):** generating cards inside the app with the configured LLM provider, from pasted notes or a PDF.

## 4. Study session

- A session studies **one deck**.
- Show the prompt, reveal the answer, rate it **Again / Hard / Good / Easy**, and FSRS reschedules the card.
- **No daily limits** on new cards or reviews.
- **Soft cap on new cards per session**, tuned for learning:
  - New cards are introduced gradually. Introductions **pause while too many cards are still in learning steps** (proposed: 10), so new material doesn't pile up faster than it can be practiced.
  - After a per-session number of new cards (proposed: 20), the session offers to **continue with more** instead of stopping on its own. The cap never blocks reviews.
- **Before the session:** the deck's due count, new card count and estimated time.
- **After the session:** a summary with cards studied, recall rate, time spent and when the next cards are due.
- **Queue order**, chosen for learning effectiveness:
  - Due reviews come first, **most at-risk first** (lowest predicted recall), so the memories closest to being forgotten are saved.
  - **New cards are mixed in** among the reviews, in **creation order**, because decks often build on earlier cards.
  - A new card's learning steps then spread out naturally between other cards.
- **Again / learning steps:** a card rated Again, or still in its learning steps, **comes back in the same session** after its short interval, with other cards shown in between. When no other card is left, it's shown early rather than leaving the user waiting.
- **Undo** the last rating.
- **Edit the current card** without leaving the session (the edit flow keeps the schedule by default).
- **Interval preview** on each rating button (e.g. "Good · 4d").
- **Input:** keyboard shortcuts on desktop. On mobile, tap to reveal and large rating buttons, with **no swipe gestures**.
- **Resume:** an interrupted session continues where it left off, including a **half-written answer** (typed text or handwriting strokes), which survives a reload or a closed tab. The draft is discarded once the card is rated, since answers aren't stored with reviews.
- **Inactivity timeout:** a session ends after **30 minutes of inactivity** (the default, configurable globally in Settings). Coming back before then resumes the session; coming back after it starts a fresh one. Cards still in learning steps when a session ends are scheduled normally.
- There is **no limit on session length** while the user is active.
- **Recorded time per card is capped** (proposed: 2 minutes), so idle time doesn't distort statistics or time estimates.

## 5. Written answers with LLM grading — core feature

This is **the core feature** of Banki and is part of the MVP.

- The learner writes an answer, an LLM suggests an FSRS rating with feedback, and the learner **always confirms** the rating (or picks another). Ratings are never applied automatically.
- **Mode is chosen per card:** write-and-grade or self-rate. A session starts in the deck's default mode (see Settings), and after that the choice **carries over from the previous card** until the learner changes it.
- **Provider (MVP):** **OpenRouter** only.
  - Settings offers a **curated list of models** that support structured output and images and **read handwritten math well**, with a strong default preselected.
- **Grading notes:** each card has an optional, hidden field telling the grader what the answer must include or may vary in (e.g. "must mention both conditions"). The card is still front/back.
- **Judge meaning, not wording:** the grader accepts mathematically equivalent answers (`x = 2` vs `2 = x`, `1/2` vs `0.5`, different notation) and different phrasings.
- **"I don't know" button:** reveals the answer and rates the card Again directly, without calling the LLM.
- **Result view:** the learner's answer, the reference answer and the feedback are shown **side by side**, with **missing parts highlighted**.
- **Feedback language** follows the language of the learner's answer.
- **Answer input** uses the same Obsidian-style editor as cards: LaTeX math, cheatsheet, autocomplete.
- **Handwritten answers — core feature:** the learner can write answers by hand with a **stylus**, on an **iPad or similar tablet**, or with a **graphics tablet** on a desktop. This works in the browser (PWA), with no native app.
  - **Pressure-sensitive ink** that follows the pen smoothly, even when it moves fast.
  - **Palm rejection:** while the stylus is in use, only stylus input draws. A resting hand neither draws nor scrolls the page.
  - **No accidental scrolling or zooming** from the stylus or a resting palm.
  - **Fingers navigate, the stylus writes** (GoodNotes as inspiration): a **single finger pans** the canvas and two fingers pinch to zoom.
  - Strokes are kept as **vector data** during the answer, not as a screenshot.
  - **Sent to the grader as an image** with only the ink, cropped to the strokes, **black ink on a white background** whatever the app's theme. This keeps the image small, cheap to send, and easy for the model to read.
  - **One request, no separate OCR:** the image goes to the multimodal model together with the question, the reference answer and the grading notes. Knowing the question helps the model read messy handwriting (an integral sign versus the letter "S").
  - **Typed or handwritten** per answer, not both mixed in one answer.
  - **Stylus only:** no finger or mouse drawing. On a device without a stylus, answers are typed.
  - **Automatic switch:** touching the answer area with a stylus switches to handwriting mode.
  - **Canvas grows as needed**, ideally in all directions (an unbounded canvas), so long derivations fit.
  - The image sent to the grader is **scaled down to a maximum size** (proposed: about 2,000 px on the longest side), keeping cost and response time predictable.
  - **Tools (MVP):** pen with adjustable thickness, eraser, undo/redo, clear. The stylus's eraser end or side button switches to the eraser where the hardware supports it. More tools may come later.
  - Crossed-out work is **ignored**, not graded.
- **Grader response** (for typed and handwritten answers):
  - The **suggested rating** and **feedback**.
  - For handwritten answers, a **transcription** of what the model read, rendered as text and LaTeX next to the feedback, so a misreading is easy to spot.
  - **Step-level errors:** for multi-line work, the feedback points at the **exact step** where the mistake happened (e.g. "line 3: lost the minus sign"), not only at the final answer.
- **When the handwriting is misread** (tentative): the learner can **correct the transcription and re-grade** it as text. The learner can always override the suggested rating anyway.
- **Images** in the card are **sent to the model** along with the text.
- **Feedback length depends on the card:** short for simple recall, a fuller explanation of what was missing or wrong for complex cards (derivations, proofs, explanations).
- **Follow-up chat:** after grading, the learner can keep chatting with the model about that card ("why is that wrong?").
- **Failures:** grading is **retried up to 5 times**. If it still fails, that card **falls back to self-rating** with a short notice.
  - Only **temporary errors** are retried (network, rate limits, server errors), **waiting longer each time** (about 10–15 s in total).
  - Permanent errors (bad API key, unknown model) **fail immediately**, with a clear message.
- **Grader agreement:** each review records the suggested rating next to the confirmed one, so analytics can show how often the learner changes it (a sign the grader is too lenient or too strict).
- **Not stored (for now):** the learner's written answers, the feedback and the chat are not kept with the review.

## 6. Deadline plans

Part of the MVP.

- A deck can have **one plan** (MVP): a **deadline date** and a **daily minutes goal**. Several plans per deck come later.
- While a plan is active, it changes the study session in three ways:
  1. **Order:** cards that most improve predicted recall **on the deadline day**, per second of study, come first.
  2. **Early review:** cards can be studied **before they're due** when that improves recall on the deadline day.
  3. **Rising target retention** as the deadline approaches.
- **New cards near the deadline:** no hard cutoff. New cards compete with reviews on the same expected-gain-per-second measure. A card learned close to the deadline still counts while the remaining time makes it worth it, and loses out to reviews once it doesn't.
- **Daily minutes are a goal, not a limit:** progress is tracked ("18 / 30 min today") and feeds the forecast, but never stops a session.
- **Feasibility check** when creating or editing a plan: warn if the goal can't cover the deck (e.g. "at 20 min/day, ~140 cards won't be learned by the deadline") and suggest the minutes needed.
- **After the deadline** the plan ends automatically, the deck returns to its normal schedule, and a **short summary** shows how the plan went.

## 7. Forecast

- Shown **only for decks with a plan**. There's no workload forecast for other decks.
- **Based on the user's real habits**, not fixed guesses:
  - actual answer times, kept separate for **self-rated** and **written-and-graded** cards
  - time per new card versus per review
  - how many minutes they actually study per day compared with the goal
- **What it shows:**
  - Predicted recall on the deadline day as a **range** (e.g. 78–86%), not a single number.
  - A **day-by-day line** from now to the deadline.
  - A list of the **cards most at risk**.
- **History:** past predictions are kept and shown as a line over time. They also feed the plan's end-of-plan summary.
- **Updates after every session**, so the deck page is always current.
- **New users:** sensible default timings are used until there's enough history, and the UI says so ("estimates improve after about 50 reviews").
- **"What if" control:** dragging the daily minutes updates the forecast immediately.
- **"Study these now"** on the at-risk list starts a session with only those cards.

## 8. FSRS tuning

The user doesn't need to understand FSRS. The defaults below were chosen for best memorization, and tuning happens without the user's involvement.

- **Automatic tuning:** parameters are re-fitted automatically as reviews accumulate (proposed: every 200 new reviews). A **manual "Tune now"** button exists too.
- **Global first, then per deck:** one global set of parameters is fitted from all reviews. A deck gets its own parameters once it has enough reviews of its own (proposed: 1,000). Until then it uses the global set.
- **The data decides the threshold:** FSRS defaults are used until there's enough history, and the app follows the FSRS library's guidance on minimum data instead of a hard 400-review rule.
- **Only apply improvements:** new parameters are applied only if they predict the user's actual recall better than the current ones. **"Reset to defaults"** is available.
- **Desired retention:** **90% by default**, editable globally and per deck (range 70–97%). A plan's rising retention overrides it while the plan is active.
- **Recommended retention:** the app suggests the retention that gives the most remembered per minute studied, shown next to the setting.
- **All confirmed ratings count,** including written-and-graded reviews, since the learner confirms those ratings.
- **Interval fuzz on:** intervals get a small random spread so cards learned together don't all come due on the same day.

## 9. History and statistics

- **Global statistics page** plus **per-deck statistics** on each deck's page.
- **Charts:**
  - an **activity calendar** (GitHub-style)
  - **minutes per day** against the daily goal
  - **actual retention**: how often cards are really recalled when due, compared with the target retention
  - **cards by stage**: new, learning, learned
  - **grader agreement**: how often the learner changes the LLM's suggested rating
- **Time ranges:** 7 days, 30 days, 90 days and all time.
- **Per-card history:** from the card list, see each review with its date, its rating, and whether it was self-rated or graded.
- **Day boundary:** a study day starts at **4:00 a.m.** in the user's **timezone** (not UTC), so late-night study counts toward the previous day.
- **No streaks or gamification.**
- Reviews of deleted cards still count (see Decks and cards).

## 10. Math rendering

Editor behavior is covered under Decks and cards. This section covers rendering.

- **Engine: KaTeX**, chosen for instant rendering in live preview and long card lists. It supports `align`, `cases`, matrices and mhchem.
- **Custom macros:** shortcuts like `\R` → `\mathbb{R}`, defined **globally or per deck**.
  - Macros are **expanded before card content is sent to the LLM** grader.
  - **Exports include the deck's macro definitions**, so exported cards still render elsewhere.
- **Errors while typing:** broken LaTeX shows **inline in red with the error message** (e.g. "Undefined control sequence \fracc").
- **Literal dollar sign:** `\$` writes a dollar sign without starting math.
- **Copying math:** clicking a rendered formula copies its LaTeX source.
- **Self-hosted:** all math assets are served locally, with no CDN.
- **Later (not MVP):** diagrams (Mermaid, TikZ).

## 11. Settings

- **Timezone:** detected from the browser automatically, and changeable.
- **Day start hour:** adjustable, **4:00 a.m.** by default.
- **Inactivity timeout:** global, **30 minutes** by default (see Study session).
- **Grading:** OpenRouter API key and a model from the curated list (see Written answers). The key is **stored encrypted** in the database and never sent back to the browser.
- **Desired retention:** global default, overridable per deck (see FSRS tuning).
- **Math macros:** global, overridable per deck (see Math rendering).
- **Defaults for new decks:** retention, macros, and the default answer mode (self-rate or write-and-grade).
- **Advanced section:** the soft-cap numbers (new cards per session, the "too many cards in learning" pause threshold).
- **Recently deleted** keeps items for **30 days**. This isn't adjustable.
- **Appearance:** the theme **follows the system** (light or dark).
- **UI language:** **English only** for the MVP.

## 12. Platform and deployment

- **Self-hosted, single user** for the MVP: one installation per person, protected by a **single password**. There are no accounts or multi-user support.
- **PWA:** installable on desktop and phone. It's **online-only**, with no offline study or sync.
- **Deployment:** **Docker** for now (not final).
  - Uploaded images live in a **mounted volume** and are **served by the app itself**, not from a build-time public folder.
- **Database:** **SQLite** for the MVP.
- **Visual design:** **start fresh**. The current look isn't carried over.
- **Responsive:** works on desktop and phone (see Study session for mobile input).
- **Tech stack:** not part of this manifest. It will be chosen in a **separate spike**.
- **Not a priority for now:** accessibility beyond the basics.

## Open questions

- **Tablet layout while handwriting:** where the question sits relative to the canvas (beside, above, collapsible). To be decided.
- **Misread handwriting:** correcting the transcription and re-grading is the tentative choice; confirm it once handwriting grading can be tried.

## Notes for the stack spike

These come from an earlier exploration of handwriting input. They are technical hints, not requirements, and the figures haven't been verified.

- A web app (PWA) is enough for stylus input; no native app is needed.
- **Pointer Events API** for input:
  - `getCoalescedEvents()` for high-frequency pen samples (up to about 240 Hz on supporting hardware)
  - `pointerType === 'pen'` for palm rejection
  - `touch-action: none` on the canvas to stop scrolling and zooming
- **perfect-freehand** (about 4 KB) for pressure-sensitive stroke rendering.
- **Grader image:** compute the strokes' bounding box to crop empty space, render to an offscreen canvas with black ink on white (no theme or grid), and export a compressed WebP. The exploration estimated a 70–80% saving in vision tokens from cropping alone; this hasn't been measured.
- **Alternative:** `@excalidraw/excalidraw` if a fuller scratchpad (shapes, diagrams) is ever wanted. It has built-in cropped export.
- The exploration assumed React, but the stack is still open.

## Later / out of scope for the MVP

Collected from the sections above:

- Reversed and cloze card types.
- Full backup and restore (progress, history, everything).
- Generating cards inside the app from pasted notes or a PDF.
- Storing written answers, grading feedback and chats with reviews.
- Several deadline plans per deck.
- Diagrams in cards (Mermaid, TikZ).
- LLM providers other than OpenRouter.
- Multiple users, accounts or a hosted service.
- Offline study and sync.
- UI languages other than English.
- More handwriting tools beyond pen, eraser, undo/redo and clear.
- Not planned: Anki import, suspending cards, streaks and gamification, swipe gestures, daily limits, finger or mouse drawing, mixed typed-and-handwritten answers, handwriting in the follow-up chat, handwriting or drawing inside cards.
