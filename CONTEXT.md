# Banki

A spaced-repetition app built around writing answers and having an LLM grade them. This glossary fixes the words used for Banki's concepts across issues, code and conversation.

## Language

**User**:
The person who owns everything in a Banki installation: folders, decks, cards, reviews and settings. Each installation has exactly one User for now.
_Avoid_: Learner, account, owner

**Deck**:
A named set of cards the User studies together, with an optional description and, later, settings of its own. It sits at the root or in one folder, and no two decks beside each other share a name, ignoring case. A deleted deck no longer counts as beside anything.
_Avoid_: collection, set

**Folder**:
A named place that holds Decks and other Folders, nested to any depth, for organizing only: it has no effect on study or scheduling. It sits at the root or in one other Folder, and no two folders beside each other share a name, ignoring case; a Folder and a Deck beside each other may. Deleting a Folder deletes everything in it, together.
_Avoid_: directory, group, category

**Card**:
One thing to remember, written as a Front and a Back in Markdown with LaTeX, in exactly one Deck. A Deck's delete deletes its Cards with it, together.
_Avoid_: note, flashcard, item

**Front**:
The side of a Card the User is shown and asked about.
_Avoid_: question, prompt

**Back**:
The side of a Card that holds what the User should recall: what self-rating reveals, and the reference the Grader compares a written answer with. Never the User's own written answer.
_Avoid_: answer, solution

**Tag**:
A one-word label on Cards, such as `irregular-verb`, for finding them again: it has no effect on study or scheduling. A Card carries any number of Tags, and the same Tag on Cards in different Decks is one Tag. A Tag exists only while some Card carries it; it has no name or life of its own to rename or delete.
_Avoid_: label, category, keyword

**Root**:
The top of the folder tree, where Home lists what isn't in any Folder. It is not a Folder itself: it has no name of its own and can't be moved, renamed or deleted.
_Avoid_: top level, home folder

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

**Grader**:
The LLM, reached through OpenRouter, that turns a written answer into a suggested rating with feedback. It only suggests: the User always confirms the rating.
_Avoid_: AI, judge, provider

**API key**:
The User's OpenRouter key, which the Grader runs on and bills to. It is a Setting, but once stored it never leaves the server: Settings shows only its last four characters.
_Avoid_: token, secret

**Model**:
The LLM the Grader runs, picked in Settings from Banki's curated list of models that read handwritten math well. A User who hasn't picked one has the default.
_Avoid_: engine, provider

**Preview**:
A disposable installation of Banki built from one commit of a branch, already set up and holding Seed data, so the change can be tried on any device. Its User is the only account it has. Every Preview is either a PR Preview or a Slug Preview, and the two never make room for each other.
_Avoid_: staging, review app, preview account

**PR Preview**:
The Preview of an open pull request. It is rebuilt from scratch on every push. It is removed when the pull request closes, when it goes a while without a push, or when it is evicted to make room for newer ones; a removed PR Preview of an open pull request comes back on its next push.

**Slug Preview**:
A Preview of any branch, without a pull request, asked for by its Slug: for example one per variant of a prototype. It is rebuilt only when it is asked for again. It is removed when it is asked to go, when its time to live runs out, or when it is evicted to make room for newer ones, and it doesn't come back by itself.
_Avoid_: prototype preview, branch preview

**Slug**:
The short name a Slug Preview is asked for by and reached at. One branch holds a Slug at a time, and the Slug is free again once its Slug Preview is removed.

**Seed data**:
The fixed sample content a Preview, or a developer's local copy, starts with: the same on every run, so two builds can be compared screen by screen.
_Avoid_: fixtures, demo data

**Edge**:
The long-lived installation at `preview.banki.dkomeza.com` that runs the newest commit of `main`. Unlike a Preview, it keeps its data across deploys and migrates it in place, so a migration that breaks existing data shows there before a Release. It starts with Seed data and goes back to it only when it is reset.
_Avoid_: staging, main preview, nightly

**Production**:
The installation at `banki.dkomeza.com` that holds the User's real data and runs the newest Release, once Edge has run that Release's commit.
_Avoid_: prod, live

**Release**:
A numbered version of Banki, `v0.1.0` and up, cut when the Maintainer merges the Release PR. Its images are the very images Edge ran, and its notes say what changed for the User.
_Avoid_: build, deploy

**Snapshot**:
The copy of an Edge or Production database taken before each deploy, which the deploy restores if the new version fails its health check.
_Avoid_: backup

### Building Banki

**Maintainer**:
The person who plans, reviews and merges changes to Banki. Not the User of an installation, even when it is the same person.
_Avoid_: user, developer, owner

**Stage**:
One piece of work on an issue that an agent does unattended: building a prototype's Variants, implementing the spec, a round against `claude-review`, or fixing after Acceptance feedback. An issue's status says which Stage comes next.
_Avoid_: job, task, step

**Runner**:
The container on the home server that runs Stages, apart from the Previews and the pull agent.
_Avoid_: agent runner, worker

**Dispatcher**:
The part of the Runner that decides, without an LLM, which Stage starts next and whether usage allows it.
_Avoid_: scheduler, orchestrator

**Broker**:
The part of the Runner that holds its keys, in a container of its own, and hands the Dispatcher and the Stages short-lived tokens made from them, so neither ever sees a key.
_Avoid_: token service, credential proxy

**Dashboard**:
The read-only web page, for the Maintainer alone, that shows what the Runner and the Dispatcher are doing and what each issue went through: the Stages running and waiting, every Stage's attempts and logs, and the Dispatcher's decisions. It changes nothing.
_Avoid_: status page, console, admin panel

**Ceiling**:
The share of the weekly usage window above which the Dispatcher starts no new Stage, but an urgent issue's. The Maintainer's own use counts toward it, so whatever is left above it stays theirs.
_Avoid_: budget, quota

**Variant**:
One candidate design in a prototype, built on a branch of its own and tried on its own Slug Preview.
_Avoid_: option, mock-up

**Design Review**:
The status in which the Maintainer tries a prototype's Variants and either picks one or asks for another round.

**Reference**:
The screenshots of the chosen Variant, which the implementation is built to and reviewed against.
_Avoid_: mock

**Acceptance**:
The status in which the Maintainer tries a finished pull request's Preview, and either sends feedback back or merges it.
_Avoid_: QA, UX review, sign-off
