# Banki

A spaced-repetition app built around writing answers and having an LLM grade them. This glossary fixes the words used for Banki's concepts across issues, code and conversation.

## Language

**User**:
The person who owns everything in a Banki installation: folders, decks, cards, reviews and settings. Each installation has exactly one User for now.
_Avoid_: Learner, account, owner

**Session**:
One sitting of studying one deck. It can be resumed, and it ends after a period of inactivity.
_Avoid_: using "session" for being signed in

**Email**:
The address the User signs in with, together with the Password. Banki never sends mail to it; it only identifies the User.

**Password**:
The secret that protects a Banki installation. The User picks it during Setup and types it, with the Email, to sign in.

**Signed in**:
The state of a browser or device that has proven the Email and Password and may use Banki. **Sign in** and **sign out** are the actions that start and end it; signing in lasts until the User signs out or stays away too long.
_Avoid_: logged in, log in, auth session, session

**Setup**:
The one-time first-run step in which the User picks the Email and Password. Until Setup is done, Banki does nothing else.
_Avoid_: onboarding, registration, sign-up

**Setup token**:
A one-time code that Banki prints to its logs while Setup isn't done, and that Setup asks for. It proves that whoever does Setup can see the server, so a stranger who reaches a fresh installation first can't claim it.

**Preview**:
A disposable installation of Banki built from one pull request, already set up and holding Seed data, so the change can be tried on any device. It is rebuilt from scratch on every push and removed when the pull request closes. Its User is the only account it has.
_Avoid_: staging, review app, preview account

**Seed data**:
The fixed sample content a Preview, or a developer's local copy, starts with: the same on every run, so two builds can be compared screen by screen.
_Avoid_: fixtures, demo data
