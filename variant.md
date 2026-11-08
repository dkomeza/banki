# b: Sheet

The chat is a sheet of its own that comes over the page, offered in the dock beside the ratings ("Ask about it"), so the graded screen stays exactly as BAN-40 left it until the User asks. Below 1024 px it rises from the dock, which stays under it with the ratings in reach (a tap above it puts it away); while its input has the focus, the dock steps aside and the sheet sits on the formatting bar, above the keyboard. From 1024 px it is a side sheet at the window's right edge, and the Card and the dock make room beside it, so the Feedback and the chat are both in view. Its header keeps the suggestion in sight ("it still suggests Hard"), and an empty chat offers two starting questions.

States: graded, chat-empty, chat, chat-streaming, chat-failed, chat-cut-off, chat-long

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the Queue's first Card: write an answer and Check, and the stubbed Grader grades it after about 2 s; then ask away, and a canned reply streams in (Stop ends it). The state pill at the bottom steps through the states: `graded` is the ln(1 + x) sketch Card, the `chat-*` states the Maclaurin series Card, as in BAN-40's `graded-mistakes`. Nothing reaches OpenRouter.
