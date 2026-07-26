# Avero — Authentication Experience Design

**Scope:** The sign-in, sign-up, password recovery, email verification, and post-authentication routing experience.
**Aligned with:** [`blueprint.md`](docs/blueprint.md), [`design-system.md`](docs/design-system.md), [`feature-specs.md`](docs/feature-specs.md), [`ai-context.md`](docs/ai-context.md).
**Backend:** Supabase Authentication (per [`ai-context.md`](docs/ai-context.md) §10 — no custom auth flows).

> Design intent: Authentication is the threshold of Avero. Before a person preserves a single Memory, this experience must already feel like stepping into a calm, private, intentional place — not a generic login form. It should feel less like "signing into an app" and more like "arriving home."

---

## 1. Overall Page Layout

### Guiding principle
One screen, one purpose. Each auth screen solves exactly one problem (per Blueprint Product Principle #2: *Every Screen Has a Purpose*). No screen combines sign-in and sign-up. No screen mixes recovery with login. Friction is reduced by never asking two questions at once.

### Desktop layout — two-panel composition
A full-viewport split into two halves:

- **Left panel (ambient / brand voice):** Occupies roughly half the viewport. A deep, soft near-black surface carrying a very subtle vertical gradient in the calm accent tone (soft blue/teal), fading to pure background at the edges. No busy photography, no stock imagery, no people — those would feel like social media. Instead, a quiet, abstract atmosphere that suggests depth and stillness. Centered on this panel:
  - The Avero wordmark, set small and refined at the top.
  - A single line of brand-voice copy near the vertical center, e.g. *"A private home for the moments that matter."* Set in the H1 emotional style, soft white, generous line-height.
  - Nothing else. The emptiness is intentional (Design System §5: *White space is intentional*).

- **Right panel (the form):** The secondary background surface, slightly lighter than the left. The auth form is vertically and horizontally centered within this panel, constrained to a comfortable reading width (roughly 400–440px). This is the single focus of the screen.

The two-panel split exists only where space allows. It is a desktop enhancement, never a requirement for usability.

### Mobile layout — single column
The ambient panel is removed entirely. The screen is a single centered column:
- The Avero wordmark sits at the top with generous breathing room.
- The form sits centered vertically, with comfortable margins on both sides (respecting the 16px / 24px spacing scale).
- A single short line of brand-voice copy may appear beneath the wordmark, but only if vertical space permits without crowding the form. Calm over completeness.

### Consistent frame across all auth screens
Every auth screen (sign-in, sign-up, recovery, verification notice) shares the same shell: same background, same panel structure, same wordmark placement, same form width. Only the form's contents change. This satisfies Blueprint Philosophy #9 (*Consistency Creates Comfort*) — the user never relearns the frame.

---

## 2. Visual Hierarchy

Hierarchy is established through **size, weight, color, and space** — never through borders, boxes, or decoration.

From most to least prominent, on every auth screen:

1. **The headline / intent statement** — the largest text, soft white, H1 emotional weight. It names what the screen is for in human language, not UI labels (Design System §3: *"Text should feel like storytelling, not UI labels"*). Examples: *"Welcome back."* (sign-in), *"Begin preserving what matters."* (sign-up).
2. **The supporting line** — one muted-gray sentence beneath the headline. It removes ambiguity without adding length. Example: *"Sign in to return to your Spaces."*
3. **The form fields** — clear, minimal, equal in visual weight. Labels sit above inputs in secondary text. Inputs themselves are quiet (minimal borders, clear focus state per Design System §6).
4. **The primary action button** — the only filled accent element on the screen. It is the single most visually weighted interactive element, signaling "this is the way forward."
5. **Secondary actions** — ghost/outline style (sign-up link, "forgot password," alternate providers). Visually subordinate so the primary path is never ambiguous.
6. **Footnotes / legal microcopy** — caption-size, darker muted gray. Present but never competing for attention.

### Color usage on auth screens
- Background: deep dark near-black (primary background).
- Form panel: secondary background surface.
- Headline + input text: soft white (primary text).
- Labels, supporting copy, links: muted gray (secondary text), with links shifting to the accent tone on hover/focus.
- Primary button: filled accent (soft blue/teal).
- Errors: a calm, desaturated warm tone — never aggressive red. Errors must feel like a gentle correction, not an alarm (Design System §8: *"Errors are clear and calm"*).

---

## 3. The User Journey

### 3.1 Returning user — sign in
1. User arrives at `/signin` (or is redirected there when accessing a protected route unauthenticated).
2. Screen shows the welcome headline, email and password fields, primary "Sign in" button, and a "Forgot password?" ghost link.
3. User enters credentials and submits.
4. Button enters loading state. On success, the user is routed onward (see §3.6).
5. On failure, a calm inline error appears (see §7).

### 3.2 New user — sign up
1. User arrives at `/signup` (from the "Create account" link on the sign-in screen).
2. Headline invites them in: *"Begin preserving what matters."*
3. Fields: name, email, password. (Name is collected because the User entity requires it — see [`database.md`](docs/database.md) §3 — and because Avero is people-first; a Memory's creator should be a person, not an anonymous handle.)
4. Beneath the form: a short, honest line about privacy — *"Your memories stay private. Only the people you invite can see them."* This reinforces Blueprint Philosophy #4 (*Private by Default*) at the very first touchpoint.
5. On submit, a verification email is sent (Supabase email confirmation). The user sees a calm confirmation screen (see §3.4) rather than being dropped into the app unverified.

### 3.3 Forgotten password — recovery
1. From sign-in, user taps "Forgot password?"
2. A dedicated screen with a single email field and a "Send reset link" primary button. Headline: *"Reset your password."* Supporting line: *"We'll email you a secure link."*
3. On submit — **regardless of whether the email exists** — the same calm confirmation is shown: *"If an account exists for that email, a reset link is on its way."* This avoids account enumeration and aligns with the security posture in [`ai-context.md`](docs/ai-context.md) §10.
4. User clicks the link in the email, lands on a "Set new password" screen with a single password field (and a confirm field), submits, and is guided to sign in.

### 3.4 Email verification notice
After sign-up, a calm full-screen notice replaces the form:
- Headline: *"Check your email."*
- Supporting line: *"We sent a verification link to **[email]**. Tap it to continue."*
- A ghost "Resend link" action and a ghost "Use a different email" action.
- No form. One clear next step lives in the user's inbox, not on the screen. This is intentional stillness.

### 3.5 Auth callback / link handling
When the user clicks an email link (verification or reset), they return to Avero via a callback route. During the brief handoff to Supabase, a centered, calm loading state is shown (see §7). On success, routing proceeds automatically. On failure (expired/invalid link), a calm error screen offers a "Resend" or "Back to sign in" path.

### 3.6 Post-authentication routing — where the user lands
This is the most important junction for emotional design. After successful authentication, routing depends on the user's state:

- **Returning user with Spaces** → routed to their Spaces home (the list of their private homes).
- **Returning user with exactly one Space** → may route directly into that Space, since there is no decision to make (Blueprint Principle #9: *Reduce Friction*).
- **New user with no Spaces** → routed to an **inspiring empty state**, not a blank dashboard. Per Blueprint Product Principle #6 (*Empty States Should Inspire*): an empty Avero is the beginning of a story, not an error. The screen should gently invite the user to create their first Space or note that they may have a pending invitation. This is the moment Avero must feel like a place worth filling — calm, welcoming, never empty in the discouraging sense.

Routing must never leave the user staring at a loading spinner indefinitely; the `isLoading` state from the existing `AuthContext` (which exposes `user` and `isLoading`) is the gate that holds the app on a calm initial loader until the session is resolved.

---

## 4. What Information Appears on the Screen

### Sign-in screen
- Wordmark (top).
- Headline: *"Welcome back."*
- Supporting line: *"Sign in to return to your Spaces."*
- Email field (labeled "Email").
- Password field (labeled "Password") with a show/hide toggle.
- Primary button: *"Sign in."*
- Ghost link: *"Forgot password?"*
- Ghost link: *"Don't have an account? Create one."*

### Sign-up screen
- Wordmark (top).
- Headline: *"Begin preserving what matters."*
- Supporting line: *"Create your account to start preserving shared memories."*
- Name field (labeled "Name").
- Email field (labeled "Email").
- Password field (labeled "Password") with a show/hide toggle and a subtle strength/requirement hint beneath.
- Primary button: *"Create account."*
- Privacy reassurance line: *"Your memories stay private. Only the people you invite can see them."*
- Ghost link: *"Already have an account? Sign in."*
- Caption microcopy: a short, plain-language reference to the Terms and Privacy Policy — present but never loud.

### Password recovery screen
- Headline: *"Reset your password."*
- Supporting line: *"We'll email you a secure link."*
- Email field.
- Primary button: *"Send reset link."*
- Ghost link: *"Back to sign in."*

### Set new password screen
- Headline: *"Choose a new password."*
- Password field + confirm field.
- Primary button: *"Update password."*

### Email verification notice
- Headline: *"Check your email."*
- Supporting line naming the email address.
- Ghost actions: *"Resend link,"* *"Use a different email."*

### What is deliberately absent
- No social proof, follower counts, or "join thousands of users" copy (Avero is not social media — Blueprint §Product Identity).
- No marketing carousel or feature bullets. Auth is a threshold, not a pitch.
- No captcha presented aggressively; if bot protection is needed, it should be invisible/behavioral, never a puzzle that breaks the calm.
- No optional profile fields at sign-up. Only what is required to create the account. Additional details can come later (Blueprint Principle #9: *Reduce Friction*; *Only ask for information that provides lasting value*).

---

## 5. Required Components

These are the reusable building blocks the auth experience is composed from. They follow the Design System component rules and the architecture guidance in [`ai-context.md`](docs/ai-context.md) §8 (focused, reusable, single-responsibility components).

### Layout components
- **AuthShell** — the shared frame: background, two-panel split (desktop) / single column (mobile), wordmark slot, and a content slot for the form. Every auth screen composes this so the frame is identical everywhere.
- **AuthFormPanel** — the centered, width-constrained container that holds a form and its surrounding copy. Enforces consistent form width and vertical rhythm.

### Form components
- **TextField** — a single, reusable input for email, name, and password. Props: label, type, value, error, helper text, leading icon (optional). Minimal border, clear focus ring in the accent tone, accessible label association. One component serves all text entry so behavior is predictable everywhere (Blueprint Principle #4: *Consistency Builds Confidence*).
- **PasswordField** — composes `TextField` and adds a show/hide visibility toggle (an outline-style eye icon, per Design System §9). The toggle must be a real button with an accessible label.
- **PrimaryButton** — filled accent, soft not aggressive, with clear hover/press/disabled/loading states. In the loading state it shows a small inline spinner and becomes non-interactive.
- **GhostLink / GhostButton** — minimal text-style navigation between auth screens and secondary actions.

### Feedback components
- **InlineError** — a calm, muted-warm message tied to a field or to the form. Never a modal, never an alarm.
- **FormNotice** — for screen-level messages like the recovery confirmation ("If an account exists…"). Centered, calm, with a subtle check or envelope outline icon.
- **Spinner / LoadingIndicator** — small, subtle, used inside buttons and on the full-screen callback/loading state. Smooth, not bouncy (Design System §7).

### Content components
- **BrandWordmark** — the Avero mark, used consistently at the top of every auth screen.
- **AuthHeading** — the emotional H1 headline + supporting line pair, kept as a unit so spacing between them is always consistent.

### Notes on reuse
Per [`ai-context.md`](docs/ai-context.md) §3 (*Reuse Before Creating*), `TextField`, `PrimaryButton`, and `GhostLink` should be the same primitives used elsewhere in the app — not auth-specific duplicates. Only `AuthShell` and `AuthFormPanel` are auth-specific, because the two-panel ambient frame is unique to this experience.

---

## 6. Mobile and Desktop Behavior

Per Blueprint Product Principle #8 (*Mobile and Desktop Are Equal*) and [`ai-context.md`](docs/ai-context.md) §9 (*Responsive Design*): no platform is an afterthought. The experience adapts naturally without a separate implementation.

### Breakpoint behavior
- **Desktop (wide):** Two-panel split. Ambient panel on one side, form panel on the other. Form constrained to ~400–440px and vertically centered.
- **Tablet / medium:** The ambient panel narrows or is gracefully de-emphasized. The form remains centered and comfortable. The split may collapse to a single column once horizontal space can no longer hold both panels with dignity.
- **Mobile (narrow):** Single column. Ambient panel removed. Wordmark at top, form centered, generous side margins (16–24px). Everything remains reachable with the thumb in the lower portion of the screen; the primary button sits comfortably within the natural thumb zone.

### Interaction differences
- **Keyboard:** On desktop, the form supports full keyboard navigation — Tab moves logically through fields to the primary action, Enter submits, focus rings are always visible (Design System §6; [`ai-context.md`](docs/ai-context.md) §9 Accessibility).
- **Touch:** On mobile, inputs trigger the native keyboard. The email field uses the email keyboard type; the password field uses the secure entry type. Tap targets meet minimum size guidelines. The show/hide password toggle is large enough to tap reliably.
- **Viewport / zoom:** Layout must remain usable when the browser is zoomed or when device text size is increased — no fixed pixel heights that clip content, no horizontal scrolling.

### Motion across breakpoints
Transitions between auth screens are subtle cross-fades or gentle slides — smooth and meaningful, never bouncy (Design System §7). The same easing and duration are used on mobile and desktop for consistency.

---

## 7. Loading and Error States

Per Blueprint Product Principle #5 (*Feedback for Every Action*) and Design System §8 (*Every interaction must give feedback, feel instant, never leave user uncertain*).

### Loading states
- **Initial session resolution:** When the app first loads, the `AuthContext` `isLoading` state holds the experience on a calm, centered loader (wordmark + subtle spinner) until the Supabase session is resolved. The user never sees protected content flash before auth is confirmed, and never sees a blank screen.
- **Button submission:** On submit, the primary button enters a loading state — label replaced or accompanied by a small spinner, button becomes non-interactive to prevent duplicate submissions.
- **Auth callback:** During email-link handoff, a centered calm loading state with a short line ("Signing you in…") is shown. No ambiguous blank screen.
- **Resend / async actions:** Any action with a wait shows inline feedback rather than leaving the user guessing.

### Error states
All errors are **calm, specific, and human** — never technical, never alarming.

- **Invalid credentials (sign-in):** A single inline message near the form, e.g. *"That email or password doesn't match."* It does not reveal which field is wrong (security). The password field may be cleared; the email field is preserved for convenience.
- **Field validation:** Inline beneath the relevant field, in muted-warm tone. Examples: *"Enter a valid email."* / *"Password must be at least 8 characters."* Validation triggers on blur and on submit, not aggressively on every keystroke (which feels nagging and breaks the calm).
- **Account already exists (sign-up):** *"An account with this email already exists. Sign in instead?"* with a link to sign-in.
- **Network / unexpected failure:** A calm, honest message: *"Something went wrong on our end. Please try again."* with a retry path. Internal details are never exposed to the user ([`ai-context.md`](docs/ai-context.md) §10: *"Do not expose internal database details"*).
- **Expired / invalid email link:** A dedicated calm screen: *"This link has expired or is no longer valid."* with a "Resend" action and a "Back to sign in" path.
- **Rate limiting / too many attempts:** A calm message asking the user to wait, with no alarming language.

### Error tone
Errors use a desaturated warm tone and a small outline icon (e.g., a subtle alert circle). They never use aggressive red, never shake the input, never play a sound. The correction should feel like a quiet nudge, consistent with Avero's calm identity.

---

## 8. Accessibility Considerations

Per [`ai-context.md`](docs/ai-context.md) §9 (*Accessibility should never be treated as an optional enhancement*) and Design System principles. Accessibility is a first-class requirement of this experience.

### Structure and semantics
- Use semantic HTML throughout: `form`, `label` (explicitly associated with each input via `for`/`id`), `button` (not styled `div`s), `main`, and heading elements in correct order (one H1 per screen).
- The wordmark is text where possible; if it is an image, it has appropriate alternative text.
- The ambient left panel is purely decorative and marked as presentational (hidden from assistive technology) so it never adds noise.

### Keyboard navigation
- Full keyboard operability: logical Tab order from wordmark → first field → … → primary button → secondary links.
- Visible focus states on every interactive element, using the accent tone — focus is never removed or hidden (Design System §6; [`ai-context.md`](docs/ai-context.md) §9).
- Enter submits the active form. The show/hide password toggle is a real, focusable button.
- No keyboard traps; the user can always navigate away.

### Labels and instructions
- Every field has a visible, programmatically associated label (not placeholder-as-label).
- Helper text and error messages are associated with their field (via `aria-describedby`) so screen readers announce them.
- Instructions are in plain language.

### Color and contrast
- All text meets sufficient contrast against the deep dark background — soft white and muted gray are chosen to remain legible (Design System §2).
- The accent tone for buttons and links meets contrast requirements for both the button text and the link text.
- Error states convey meaning through text and icon, not color alone — so colorblind users and users who override colors still understand them.
- Information is never communicated by color alone.

### Motion and reduced motion
- All transitions respect the user's "reduce motion" preference: when reduced motion is requested, cross-fades/slides are shortened or removed, and spinners remain but decorative motion is eliminated (Design System §7: motion should explain change, not distract).
- No auto-playing or looping decorative animation on auth screens.

### Cognitive load
- One purpose per screen, one primary action, minimal fields — reducing cognitive effort (Blueprint Principle #9: *Reduce Friction*).
- Error messages are actionable and specific, telling the user exactly what to do next.
- The email verification and recovery flows set clear expectations about where the next step happens (the inbox), so the user is never left wondering.

### Robustness
- Layout remains functional under browser zoom and increased text size.
- Forms work without JavaScript-dependent decoration: core fields and labels remain understandable even if enhancement fails to load.
- The experience degrades gracefully — calm and usable above all else.

---

### Design summary
This authentication experience is built to feel like a threshold into a private, meaningful place. It is calm through restraint (one focus per screen, generous space, quiet colors), premium through craft (consistent type scale, soft surfaces, subtle motion), and timeless through simplicity (no trends, no social-media mechanics, no decorative noise). Every decision answers the Blueprint's guiding question: *Will this help someone feel, years from now, that Avero is their space, their people, their memories?* — starting from the very first screen they see.
