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
The one-time first-run step in which the User picks the Email and Password, done on the Setup page or from a shell on the server. Until Setup is done, Banki does nothing else.
_Avoid_: onboarding, registration, sign-up

**Setup token**:
A one-time code that Banki prints to its logs while Setup isn't done, and that the Setup page asks for. It proves that whoever does Setup can see the server, so a stranger who reaches a fresh installation first can't claim it.

**Settings**:
The User's choices that apply across every device, kept on the server and changed on the Settings page. Choices that belong to one device only, such as the theme, are not Settings.
_Avoid_: preferences, config

**Timezone**:
The timezone Banki counts the User's days in. Banki takes it from the first browser the User signs in with and changes it only when the User does, even when a device is in another timezone.

**Day start**:
The hour, in the User's Timezone, at which one Study day ends and the next begins. 4:00 a.m. unless the User changes it.
_Avoid_: rollover, cutoff

**Study day**:
The day a moment belongs to for everything Banki counts per day: due cards, daily minutes, statistics. It runs from one Day start to the next, so studying at 1:00 a.m. counts toward the day before. A review's Study day follows from when it happened and the current Timezone and Day start, so changing either moves past reviews too.
_Avoid_: calendar day, date

**Preview**:
A disposable installation of Banki built from one pull request, already set up and holding Seed data, so the change can be tried on any device. It is rebuilt from scratch on every push. It is removed when the pull request closes, when it goes a while without a push, or when it is evicted to make room for newer ones; a removed Preview of an open pull request comes back on its next push. Its User is the only account it has.
_Avoid_: staging, review app, preview account

**Seed data**:
The fixed sample content a Preview, or a developer's local copy, starts with: the same on every run, so two builds can be compared screen by screen.
_Avoid_: fixtures, demo data
