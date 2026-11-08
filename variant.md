# c: Ask line

The chat's input lives in the dock, a line above the ratings ("Ask about this card…"), so asking is always one tap away (or `/` on a keyboard) and the question is written where the thumb already is, like a messaging app. The thread goes on at the end of the page, under the Back (from 1024 px in the answer's column, the Feedback still in its margin), so a reply reads as the next part of the Card, and a message sent scrolls it into view. While the input has the focus on a phone or tablet, the ratings fold away and leave the input over the keyboard and the formatting bar. The long-chat advice is a quiet line in the dock, right above the input and the ratings.

States: graded, chat-empty, chat, chat-streaming, chat-failed, chat-cut-off, chat-long

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the Queue's first Card: write an answer and Check, and the stubbed Grader grades it after about 2 s; then ask away, and a canned reply streams in (Stop ends it). The state pill at the bottom steps through the states: `graded` is the ln(1 + x) sketch Card, the `chat-*` states the Maclaurin series Card, as in BAN-40's `graded-mistakes`. Nothing reaches OpenRouter.
