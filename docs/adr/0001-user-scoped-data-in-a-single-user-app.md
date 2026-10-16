# User-scoped data in a single-user app

The MVP is self-hosted with one User behind a single password, but Banki may later become a multi-user SaaS. We store that one User as a real row and attach every top-level record (folders, decks, cards, reviews, settings, uploads) to it from the start, with every query scoped by User, because retrofitting that scoping onto every query later costs far more than the extra column does now. We deliberately build nothing else for multiple users yet: no sign-up, no account management, no cross-User isolation testing.
