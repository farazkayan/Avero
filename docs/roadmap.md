# Avero Development Roadmap

**Version:** 1.0

**Status:** 🟡 In Progress

# 📍 Project Progress

🟢 Blueprint
🟢 Roadmap
🟢 Design System
🟢 Database
🟢 Feature Specs
🟢 Supabase Setup
🟢 Frontend Setup
🟢 Tailwind Setup
🟢 Avero 0.1

## Meaning

* 🟢 Completed
* 🟡 In Progress
* ⚪ Not Started

---

## Phase 1 — Foundation

### Goal
Establish the project's technical foundation and development environment.

### Features
* Initialize the project
* Configure the tech stack
* Set up Supabase
* Configure authentication
* Establish folder structure
* Create the design system foundation

### Definition of Done
* The project runs locally.
* Users can create accounts.
* Users can sign in and sign out.
* Authentication persists across sessions.
* Supabase is connected successfully.
* The project structure is finalized.

---

## Phase 2 — Spaces

### Goal
Allow users to create and join shared Spaces.

### Features
* Create Space
* Invite members
* Join Space
* Space management

### Definition of Done
* Users can own Spaces.
* Invitations work.
* Members can join.
* Space permissions function correctly.

---

## Phase 3 — Memories

### Goal
Allow members to preserve shared experiences.

### Features
* Capture Memory
* Edit Memory
* Delete Memory
* Memory details
* Media uploads

### Definition of Done
* Members can create Memories.
* Photos and videos upload successfully.
* Memories can be edited.
* Memories can be deleted safely.

---

## Phase 4 — Experience

### Goal
Make Memories enjoyable to revisit and organize.

### Features
* Timeline
* Tags
* Search
* Comments
* Reactions

### Definition of Done
* Timeline displays correctly.
* Search returns accurate results.
* Tags organize Memories.
* Comments work reliably.
* Reactions function as intended.

---

## Phase 5 — Polish

### Goal
Prepare Avero for everyday use.

### Features
* Responsive design
* Loading states
* Empty states
* Error handling
* Performance improvements
* Accessibility improvements
* Final testing
* Bug fixing

### Definition of Done
* No critical bugs remain.
* Mobile and desktop experiences are polished.
* Performance is smooth.
* The application feels ready for daily use.

---

## Phase 6 — Social & Personalization

### Goal
Round out the social and personal layer of the app: richer comment interactions, user identity (avatar), account settings, and a light theme option.

### Features

**Comments enhancements**
* Sort option in Comments (e.g. newest / oldest)
* Replace the delete icon with a three-dot (⋮) menu on each comment:
  * Own comment → Edit, Delete
  * Others' comment → Report
* Comment editing (new capability — comments were previously add/delete only)
* Reactions on individual comments (in addition to existing Memory-level reactions)
* Emoji picker on the comment input (not just plain text entry)

**Identity & account**
* Profile picture (avatar) upload — `avatar_url` already exists on the Users table (`database.md` §3), this wires it up end-to-end
* Settings page — manage account details, avatar, and (new) theme preference

**Theming**
* White / light theme option, toggleable in Settings — the current Design System (§2) is dark-only; this adds a second supported theme without abandoning dark as the default

### Definition of Done
* Comments can be sorted, edited, deleted, and reported.
* Comments support their own reactions and emoji entry.
* Users can upload/change a profile picture.
* A Settings page exists for account + theme preferences.
* Light theme is fully supported across existing screens, not just new ones.

### Explicitly Out of Scope (unchanged from Blueprint)
* Public Spaces
* Public profiles
* Any feature that turns Avero into a public/social-media-style platform — Avero remains private-Space-only, per `blueprint.md`'s "Who Avero Is Not Built For."

---

## Avero 0.1 Complete

At the end of Phase 6, Avero should provide everything needed for a small group of people to preserve and revisit their shared memories in a reliable, polished, and enjoyable way — with a personalized identity layer and richer, but still calm, social interactions.

Also delivered as part of / alongside 0.1 hardening:
* Space Statistics & Achievements (retrospective, non-manipulative — see `blueprint.md` §10, §8)
* Major performance & media optimization pass (image compression, dual thumbnails, lazy loading, code splitting, DB query audit)
* Full-quality media download (available to all Space members)
* Cloudflare Worker media proxy for free B2 egress (Bandwidth Alliance), with HMAC-signed, time-limited access tokens

---

## Phase 7 — Accounts & Identity Polish

### Goal
Make account creation faster with Google sign-in as a login option.

### Features

**Google OAuth login**
* "Continue with Google" as an additional sign-in option alongside existing email auth
* Auto-populate profile display name and avatar from the user's Google account on first sign-in (avatar copied through the existing upload/crop pipeline into B2, not linked externally)
* New-signups/new-logins only for this pass — account linking (existing email-auth user linking a Google identity) is out of scope

### Definition of Done
* Users can sign in/sign up with Google in one tap, with their name and photo populated automatically.

**Apple Sign-In:** considered and explicitly rejected — not planned, ever (not just deferred).

**Facebook Login:** considered and deliberately excluded — conflicts with Blueprint's explicit "not a social media platform" positioning and has declining trust/usage for non-social apps.

---

## Phase 8 — Maps & Location

### Goal
Let users select real locations when creating a Memory, and view a Space's Memories plotted on a map — using free infrastructure (LocationIQ + OpenStreetMap/Leaflet), not Google Maps, given no paid API budget currently.

### Features

**Location picker (Create/Edit Memory)**
* Replace the free-text Location field with a search-as-you-type picker backed by LocationIQ's Autocomplete API (free tier: 5,000 requests/day, no credit card required, built specifically for type-ahead search — better fit than raw Nominatim)
* Selecting a result stores real coordinates (lat/lng) alongside the existing text, not just a string
* Debounce search input to stay well within free tier limits

**Space map view**
* New "Map" view within a Space (alongside Timeline/Stats), using `react-leaflet` to render OpenStreetMap tiles (free, no API key needed for tile display)
* Pin for every Memory that has coordinates (from the location picker above — Memories without a set location simply don't appear on the map, no error state needed)
* Tapping a pin opens that Memory

**Attribution**
* LocationIQ's free tier requires a small attribution credit in the app (standard for free map stacks — OpenStreetMap tiles also require their own small attribution, typically shown as a map corner credit)

**Database**
* `memories` table needs real `latitude`/`longitude` columns (currently `location` is just an optional string per `database.md` §6) — this is a schema change, not just a frontend addition
* Existing Memories with only a text location and no coordinates simply won't have a map pin until re-edited — no forced backfill/geocoding of old free-text locations required for this pass

### Definition of Done
* Creating a Memory lets you search and select a real place via LocationIQ autocomplete, storing real coordinates.
* A Space's Map view shows pins for every geocoded Memory, tapping opens it.
* Required attribution correctly displayed for both LocationIQ and OpenStreetMap.
* No Google Maps dependency, no API costs at current usage levels.

---

## Phase 9 — Echoes

### Goal
Make revisiting the past feel like a pleasant discovery, never a pull to re-engage — a passive, Google Photos-style "memories carousel" at the top of the Timeline.

### Features

**Echoes ("On this day")**
* A small horizontal carousel of cards at the top of the Timeline (Google Photos "memories carousel" style)
* Each card represents one qualifying time interval where a real Memory exists matching today's date — pure date-math, no AI:
  * "1 week ago"
  * "1 month ago"
  * "1 year ago"
  * "N years ago" (calculated dynamically for any matching year back, not a fixed list)
  * "1 decade ago" (10 years)
  * General rule: for any Memory whose `memory_date` falls exactly on today's date in a previous week/month/year, generate a card for that interval
* A card only appears if a real Memory actually exists for that specific interval — no placeholder/empty cards, no forced intervals. Some days show zero cards, some show several.
* Card shows the Memory's thumbnail + the simple label ("1 year ago") — no AI-generated text, just the honest interval + a glimpse of the photo
* **Hard rule, non-negotiable per Blueprint: passive only.** No push notification, no email, no badge/red-dot. If the user doesn't open the app that day, they simply never see it — no missed-it feeling engineered.
* Tapping a card opens that Memory
* If nothing qualifies today, the carousel simply doesn't render — no empty state needed

### Definition of Done
* Echoes surface naturally on matching dates, entirely opt-in-by-nature (passive discovery), with zero push/notification mechanism attached.

---

## Backlog (queued, not yet built)

* Memory Timeline sort control (Newest / Oldest / Recently added)
* Avatar refresh bug — new avatar doesn't display until manual page refresh
* Media download attribution/UI polish follow-ups (as needed)

---

## Explicitly Excluded (permanent, not deferred)

Per Blueprint's "Who Avero Is Not Built For" and product decisions made during development:

* Public Spaces
* Public profiles
* Messaging
* AI features of any kind — permanently excluded, not just postponed
* Apple Sign-In — permanently excluded
* Facebook Login — permanently excluded
* Any feature that turns Avero into a public/social-media-style platform