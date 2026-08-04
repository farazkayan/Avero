\\# Avero Development Roadmap







\\\*\\\*Version:\\\*\\\* 1.0







\\\*\\\*Status:\\\*\\\* 🟡 In Progress











\# 📍 Project Progress







🟢 Blueprint



🟢 Roadmap



🟢 Design System



🟢 Database



🟢 Feature Specs



🟢 Supabase Setup



🟡 Frontend Setup (RUNNING)



⚪ Tailwind Setup (NEXT)



⚪ Avero 0.1⚪ Avero 0.1







\\## Meaning







\\\* 🟢 Completed



\\\* 🟡 In Progress



\\\* ⚪ Not Started







\\---







\\## Phase 1 — Foundation







\\### Goal







Establish the project's technical foundation and development environment.







\\### Features







\\\* Initialize the project



\\\* Configure the tech stack



\\\* Set up Supabase



\\\* Configure authentication



\\\* Establish folder structure



\\\* Create the design system foundation







\\### Definition of Done







\\\* The project runs locally.



\\\* Users can create accounts.



\\\* Users can sign in and sign out.



\\\* Authentication persists across sessions.



\\\* Supabase is connected successfully.



\\\* The project structure is finalized.







\\---







\\## Phase 2 — Spaces







\\### Goal







Allow users to create and join shared Spaces.







\\### Features







\\\* Create Space



\\\* Invite members



\\\* Join Space



\\\* Space management







\\### Definition of Done







\\\* Users can own Spaces.



\\\* Invitations work.



\\\* Members can join.



\\\* Space permissions function correctly.







\\---







\\## Phase 3 — Memories







\\### Goal







Allow members to preserve shared experiences.







\\### Features







\\\* Capture Memory



\\\* Edit Memory



\\\* Delete Memory



\\\* Memory details



\\\* Media uploads







\\### Definition of Done







\\\* Members can create Memories.



\\\* Photos and videos upload successfully.



\\\* Memories can be edited.



\\\* Memories can be deleted safely.







\\---







\\## Phase 4 — Experience







\\### Goal







Make Memories enjoyable to revisit and organize.







\\### Features







\\\* Timeline



\\\* Tags



\\\* Search



\\\* Comments



\\\* Reactions







\\### Definition of Done







\\\* Timeline displays correctly.



\\\* Search returns accurate results.



\\\* Tags organize Memories.



\\\* Comments work reliably.



\\\* Reactions function as intended.







\\---







\\## Phase 5 — Polish







\\### Goal







Prepare Avero for everyday use.







\\### Features







\\\* Responsive design



\\\* Loading states



\\\* Empty states



\\\* Error handling



\\\* Performance improvements



\\\* Accessibility improvements



\\\* Final testing



\\\* Bug fixing







\\### Definition of Done







\\\* No critical bugs remain.



\\\* Mobile and desktop experiences are polished.



\\\* Performance is smooth.



\\\* The application feels ready for daily use.







\\---







\\---



\## Phase 6 — Social \& Personalization



\### Goal



Round out the social and personal layer of the app: richer comment interactions, user identity (avatar), account settings, and a light theme option.



\### Features



\*\*Comments enhancements\*\*

\* Sort option in Comments (e.g. newest / oldest)

\* Replace the delete icon with a three-dot (⋮) menu on each comment:

&#x20; \* Own comment → Edit, Delete

&#x20; \* Others' comment → Report

\* Comment editing (new capability — comments were previously add/delete only)

\* Reactions on individual comments (in addition to existing Memory-level reactions)

\* Emoji picker on the comment input (not just plain text entry)



\*\*Identity \& account\*\*

\* Profile picture (avatar) upload — `avatar\_url` already exists on the Users table (`database.md` §3), this wires it up end-to-end

\* Settings page — manage account details, avatar, and (new) theme preference



\*\*Theming\*\*

\* White / light theme option, toggleable in Settings — the current Design System (§2) is dark-only; this adds a second supported theme without abandoning dark as the default



\### Definition of Done



\* Comments can be sorted, edited, deleted, and reported.

\* Comments support their own reactions and emoji entry.

\* Users can upload/change a profile picture.

\* A Settings page exists for account + theme preferences.

\* Light theme is fully supported across existing screens, not just new ones.



\### Explicitly Out of Scope (unchanged from Blueprint)



\* Public Spaces

\* Public profiles

\* Any feature that turns Avero into a public/social-media-style platform — Avero remains private-Space-only, per `blueprint.md`'s "Who Avero Is Not Built For."



\---



\## Avero 0.1 Complete
---

## Phase 7 — Accounts & Identity Polish

### Goal
Make account creation faster with Google sign-in as a login option.

### Features

**Google OAuth login**
* "Continue with Google" as an additional sign-in option alongside existing email auth
* Auto-populate profile display name and avatar from the user's Google account on first sign-in (avatar copied through the existing upload/crop pipeline into B2, not linked externally)
* Decide scope: new-signups only, or allow existing email-auth users to link a Google identity to their account

### Definition of Done
* Users can sign in/sign up with Google in one tap, with their name and photo populated automatically.


---

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
---







At the end of Phase 7, Avero should provide everything needed for a small group of people to preserve and revisit their shared memories in a reliable, polished, and enjoyable way — with a personalized identity layer and richer, but still calm, social interactions.

