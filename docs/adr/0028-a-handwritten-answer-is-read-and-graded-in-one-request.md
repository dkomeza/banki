# A handwritten answer is read and graded in one request

A handwritten Written answer goes to the Grader as an image, in the same chat completion as the Front, the Back and the grading notes, and the Grader answers its Transcription together with the grade. There is no separate OCR step. Knowing the question and the reference is what lets a model read messy handwritten math (an integral sign rather than the letter "S"), and a reader that sees only the ink can't use it. The Transcription is the Grader's own output, so the Highlights of what the answer got wrong point into it, mapped from a line and a quote as typed answers' are.

Which Model reads it is a Setting with three modes: the Model, as for typed answers; Escalation, where the Model grades first and, when it reports it was unsure of its reading (or wrote `[illegible]`), the Handwriting model grades again and its grade replaces the first; or always the Handwriting model. The unsure signal is a two-value field the Grader fills from stated rules, not a numeric confidence, which models report poorly calibrated.

## Considered Options

- **OCR first, then grade the text**: one more model or service, a reader that doesn't know the question, and its misreads graded as if the student wrote them.
- **Escalation on a numeric confidence with a threshold**: looks tunable, but self-reported numbers cluster high and the threshold would be guesswork.
- **Mistakes as boxes on the image**: points straight at the ink, but models place coordinates unreliably, and the Transcription already shows what was read.

## Consequences

- A confident misread (∫ read as S) is not caught by Escalation; the Transcription makes it visible to the User, who confirms the Rating anyway.
- An escalated answer costs two calls and waits for both.
- Correcting a misread and grading again (BAN-50) can grade the corrected Transcription as a typed answer, with no new request shape.
