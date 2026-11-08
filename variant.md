# a: Margin thread

The chat goes on right under the Feedback, in the same margin: "Ask about this" below the Feedback opens it there, so each question sits beside the answer it is about, and from 1024 px the margin widens a little and runs down the page with the input pinned just above the dock. Below 1024 px the thread follows the Feedback in the page, before the Back, and while the input has the focus the dock steps aside so the keyboard, the input and the formatting bar have the screen.

States: graded, chat-empty, chat, chat-streaming, chat-failed, chat-cut-off, chat-long

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the Queue's first Card: write an answer and Check, and the stubbed Grader grades it after about 2 s; then ask away, and a canned reply streams in (Stop ends it). The state pill at the bottom steps through the states: `graded` is the ln(1 + x) sketch Card, the `chat-*` states the Maclaurin series Card, as in BAN-40's `graded-mistakes`. Nothing reaches OpenRouter.
