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







At the end of Phase 7, Avero should provide everything needed for a small group of people to preserve and revisit their shared memories in a reliable, polished, and enjoyable way — with a personalized identity layer and richer, but still calm, social interactions.

