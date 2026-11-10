# A graded Review keeps the suggestion the client reports

A Review is graded exactly when the User rated with the Grader's suggested Rating on screen, and then it keeps that suggested Rating and the Model that suggested it; a self-rated one keeps neither, and one CHECK holds the three together. The server keeps no grade (the Written answer, the Feedback and the grade live only in the Session, in the browser), so the client sends the suggested Rating and the Model back with the Rating, as the grade answered them, and the server records them as sent. Banki has one User, rating their own Cards (ADR-0001), so nobody gains by sending a false suggestion, and recording one would only skew their own Grader agreement.

The Model is the one that produced the suggestion, as the grade reports it, not the User's Model at rating time: they differ when the User changes it mid-Session, or when grading escalates to another Model (BAN-49). It is stored as the Model's ID, not tied to the curated list, since a release may remove a Model whose graded Reviews stay.

## Considered Options

- **The server records each grade it gives, and the Rating names it**: the suggestion couldn't be forged, but the server would keep grading state it otherwise never holds, for a single User who has no reason to forge it.
- **Graded for every Rating after Check, the suggestion nullable**: the history would show which Cards were answered in writing, but "graded" would no longer mean the Grader graded it, and Grader agreement would have to skip graded Reviews without a suggestion.
- **No Model**: one field fewer, but Grader agreement could never be told apart by Model for the Reviews given before one was stored.

## Consequences

- Reviews given before this, written-and-graded ones included, stay self-rated with no suggestion: theirs was never sent.
- An Undo brings a Card back without its suggestion (BAN-40), so rating it again records a self-rated Review.
- A grade kept in a Session from before the grade reported its Model is dropped on resume, and its Card resumes as not graded.
