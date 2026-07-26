\# Avero AI Context



\## Purpose



This document is the permanent onboarding guide for any AI assistant contributing to the Avero project.



Before generating code, making architectural decisions, refactoring existing features, or proposing new functionality, every AI assistant must read this document along with the documentation inside the `/docs` directory.



The objective is to ensure every contribution remains consistent with Avero's vision, architecture, design language, and long-term goals.



\---



\# 1. Project Overview



Avero is a private, shared memory journal designed to help people preserve meaningful moments with the people who matter most.



Unlike social media, Avero is not designed for public audiences, algorithms, popularity, or content consumption.



Instead, Avero helps small, trusted groups—such as close friends, families, couples, classmates, teammates, and travel groups—capture, organize, and revisit shared experiences over time.



The primary entity of the application is a \*\*Memory\*\*, not a photo or video.



Every Memory represents a meaningful experience and may contain media, comments, reactions, tags, locations, and other contextual information that helps preserve the complete story.



Memories exist inside \*\*Spaces\*\*, which represent private groups of people sharing a common history.



The product prioritizes long-term emotional value over short-term engagement.



Every engineering decision should support the mission of helping people remember meaningful moments for years to come.

---



\# 2. Documentation Hierarchy



The `/docs` directory is the single source of truth for the Avero project.



Before implementing new features or modifying existing ones, AI assistants should consult the relevant documentation instead of making assumptions.



If multiple documents are relevant, they should be followed in the following priority order:



1\. `blueprint.md`

&#x20;  - Defines the product vision, philosophy, long-term goals, core concepts, and product principles.

&#x20;  - If any implementation conflicts with the Blueprint, the Blueprint always takes priority.



2\. `feature-specs.md`

&#x20;  - Defines how features should behave from a product perspective.

&#x20;  - AI should not invent feature behavior that contradicts these specifications.



3\. `design-system.md`

&#x20;  - Defines the visual language, UI principles, spacing, typography, colors, animations, and interaction patterns.

&#x20;  - New UI should follow this document consistently.



4\. `database.md`

&#x20;  - Defines the data model and relationships.

&#x20;  - AI should not introduce new entities or relationships unless explicitly requested.



5\. `roadmap.md`

&#x20;  - Defines development phases and feature priorities.

&#x20;  - Features scheduled for future phases should not be implemented early unless specifically requested.



If documentation appears incomplete, AI should ask for clarification instead of inventing project decisions.



AI should never overwrite documented project decisions with its own preferences.

---



\# 3. Engineering Principles



Every contribution to Avero should prioritize long-term maintainability over short-term speed.



AI assistants should produce code that is easy to understand, easy to extend, and easy to refactor.



The following principles apply to every implementation:



\## Build for the Long Term



Choose solutions that remain clean as the application grows.



Avoid shortcuts that create technical debt unless explicitly requested.



\---



\## Readability Over Cleverness



Prefer clear and descriptive code over complex or highly condensed solutions.



Future contributors should be able to understand the code without unnecessary mental effort.



\---



\## Consistency Over Personal Preference



Follow the existing architecture, naming conventions, folder structure, and coding patterns.



Do not introduce new patterns simply because they are valid alternatives.



\---



\## Reuse Before Creating



Before creating a new component, utility, or helper, check whether an existing one already solves the problem.



Avoid duplicate implementations.



\---



\## Keep Components Focused



Each component, function, and module should have a single, well-defined responsibility.



If something begins serving multiple unrelated purposes, it should be split into smaller pieces.



\---



\## Explicit Over Implicit



Write code that clearly communicates intent.



Avoid hidden behavior, unnecessary abstraction, and "magic" logic that makes the code difficult to follow.



\---



\## Preserve Stability



Never modify unrelated files while implementing a feature.



Changes should remain as small and focused as possible.



If a refactor is beneficial but outside the current task, explain it separately instead of mixing it into the implementation.



\---



\## Respect Existing Decisions



Project documentation and established architecture always take priority over AI preferences.



If uncertain, ask for clarification rather than making assumptions.

---



\# 4. Tech Stack \& Architecture



\## Current Technology Stack



The Avero project currently uses the following technologies:



\### Frontend



\- React

\- TypeScript

\- Vite

\- Tailwind CSS



\### Backend



\- Supabase



\### Authentication



\- Supabase Authentication



\### Database



\- PostgreSQL (managed by Supabase)



\---



\## Architectural Philosophy



Avero follows a modular, component-based architecture.



The project should grow by composing small, reusable building blocks rather than creating large, tightly coupled components.



The preferred architecture is:



\- Pages compose features.

\- Features compose reusable UI components.

\- Components remain focused on a single responsibility.



Business logic should remain separate from presentation whenever practical.



\---



\## Introducing New Technologies



AI assistants should not introduce new frameworks, libraries, state management solutions, UI kits, or major dependencies unless explicitly requested.



Avoid dependency bloat.



Prefer the existing stack whenever possible.



If an external dependency would provide significant long-term value, explain why before recommending it.



\---



\## Maintain Architectural Consistency



When adding new code:



\- Follow the existing folder structure.

\- Reuse existing utilities.

\- Reuse existing UI components.

\- Avoid duplicate logic.

\- Keep modules small and cohesive.



Consistency across the project is more valuable than individual implementation preferences.

---



\# 5. Development Workflow



AI assistants should follow the same workflow used by the Avero development team.



The goal is not only to produce correct code, but to make every change understandable, reviewable, and maintainable.



\## Before Writing Code



Before making any changes:



\- Read the relevant documentation inside `/docs`.

\- Understand the requested feature.

\- Identify which files need to be modified.

\- Avoid making assumptions about missing requirements.



If requirements are unclear, ask for clarification before implementing.



\---



\## Planning



Before generating code, briefly explain:



\- What will be changed.

\- Which files will be modified.

\- Why those changes are necessary.

\- Any potential side effects.



Do not begin implementation until the plan has been presented.



\---



\## Implementation



When implementing a feature:



\- Modify only files related to the requested task.

\- Keep changes focused and minimal.

\- Reuse existing components whenever possible.

\- Follow existing coding patterns.

\- Avoid introducing unnecessary abstractions.



\---



\## After Implementation



After completing the task:



\- Explain what was changed.

\- Explain why the implementation was chosen.

\- Mention any future improvements that could be made, but do not implement them unless requested.



\---



\## Error Handling



If an unexpected issue is discovered:



\- Explain the issue clearly.

\- Suggest the safest solution.

\- Avoid applying risky changes without approval.



\---



\## Code Reviews



Assume every change will be reviewed by another engineer.



Write code that is clean, self-explanatory, and easy to review.

---



\# 6. Code Standards



Every contribution should feel like it was written by the same engineering team.



Consistency is more important than personal coding style.



\## General Principles



\- Write simple, readable code.

\- Prefer clarity over cleverness.

\- Avoid premature optimization.

\- Keep implementations predictable.

\- Minimize technical debt.



\---



\## Naming



Use descriptive names that clearly communicate purpose.



Prefer:



\- `MemoryCard`

\- `CreateMemoryDialog`

\- `SpaceList`

\- `useCurrentUser`



Avoid vague names such as:



\- `Card2`

\- `Temp`

\- `Helper`

\- `Data`

\- `Utils`



\---



\## Components



Components should:



\- Have a single responsibility.

\- Be reusable whenever practical.

\- Remain relatively small.

\- Receive explicit props.

\- Avoid unnecessary internal complexity.



If a component becomes difficult to understand, consider splitting it into smaller components.



\---



\## Functions



Functions should:



\- Perform one task.

\- Have descriptive names.

\- Return predictable results.

\- Avoid hidden side effects whenever possible.



\---



\## TypeScript



Always prefer strong typing.



Avoid:



\- `any`

\- unnecessary type assertions

\- loosely typed objects



Prefer explicit interfaces and types whenever practical.



Type safety is considered a feature, not an inconvenience.



\---



\## Comments



Code should usually explain itself.



Only add comments when explaining:



\- business rules

\- architectural decisions

\- non-obvious behavior



Do not comment obvious code.



\---



\## Imports



Keep imports organized.



Remove unused imports.



Prefer project-relative imports unless a path alias has been established.



\---



\## File Organization



Each file should have a clear purpose.



Avoid combining unrelated functionality into a single file.



As the project grows, prioritize maintainability over reducing file count.

---



\# 7. Folder Structure



The project should maintain a predictable and scalable folder structure.



Every file should have a clear purpose and belong in the most appropriate location.



\## Repository Structure



```

Avero/

├── app/

│   └── avero/

├── docs/

├── assets/

└── README.md

```



\- `app/avero` contains the React application.

\- `docs` contains the project's documentation and source of truth.

\- `assets` contains design assets and static resources used during development.



\---



\## React Application Structure



The React application should remain modular and organized.



As the project grows, code should be grouped by responsibility rather than convenience.



Examples include:



\- `components/` — reusable UI components

\- `pages/` — top-level application pages

\- `features/` — feature-specific logic and UI

\- `hooks/` — reusable React hooks

\- `lib/` — shared libraries and external service clients

\- `types/` — shared TypeScript types

\- `utils/` — pure utility functions

\- `styles/` — global styling resources



Additional folders may be introduced when justified by the project's growth.



\---



\## Organization Rules



\- Keep related files together.

\- Avoid deeply nested folder structures unless necessary.

\- Do not create new top-level folders without a clear architectural reason.

\- Prefer expanding existing modules before introducing parallel structures.

\- Group code by feature or responsibility, not by file type alone.



A consistent folder structure improves discoverability, maintainability, and onboarding for both humans and AI assistants.

```

---



\# 8. React \& TypeScript Standards



React and TypeScript should be used in a way that prioritizes clarity, maintainability, and predictable behavior.



\## React Principles



\- Prefer functional components.

\- Keep components focused on a single responsibility.

\- Lift state only when necessary.

\- Keep component trees easy to understand.

\- Prefer composition over deeply nested conditional rendering.

\- Avoid unnecessary re-renders and complexity.



\---



\## State Management



\- Keep state as local as possible.

\- Do not introduce a global state management library unless explicitly approved.

\- Share state only when multiple parts of the application genuinely require it.

\- Prefer simple React patterns before introducing additional abstraction.



\---



\## Props



Components should receive explicit, well-defined props.



Avoid passing large objects when only a few properties are required.



Prefer descriptive prop names over abbreviated ones.



\---



\## Custom Hooks



Create custom hooks only when logic is reused or clearly separated from presentation.



Hooks should:



\- Have a single responsibility.

\- Begin with the `use` prefix.

\- Be reusable.

\- Avoid containing unrelated business logic.



\---



\## TypeScript



Use TypeScript to improve correctness rather than simply satisfy the compiler.



Prefer:



\- Explicit interfaces for component props.

\- Well-defined shared types.

\- Narrow, predictable types.



Avoid:



\- `any`

\- unnecessary type assertions

\- overly broad union types

\- disabling TypeScript checks



\---



\## Error Handling



Handle expected errors gracefully.



Avoid silently ignoring failures.



Where appropriate, surface meaningful error messages to users while keeping implementation details internal.



\---



\## Performance



Optimize only when there is a measurable benefit.



Do not sacrifice readability for premature optimization.



Prefer clean implementations first, then optimize based on real needs.

---



\# 9. UI \& Design Standards



Every interface should reflect Avero's design philosophy: calm, intentional, and timeless.



Users should focus on their memories, not the interface itself.



When designing or implementing UI, always follow `docs/design-system.md`.



\## General Principles



\- Prioritize clarity over decoration.

\- Keep interfaces clean and uncluttered.

\- Every element should have a clear purpose.

\- Avoid visual noise and unnecessary complexity.

\- Maintain a premium, polished appearance.



\---



\## Component Philosophy



Build reusable UI components whenever practical.



If the same UI pattern appears multiple times, extract it into a shared component instead of duplicating markup.



Pages should be composed from reusable building blocks rather than large, page-specific implementations.



\---



\## Styling



Use Tailwind CSS as the primary styling solution.



Prefer reusable UI components over repeatedly copying long utility class lists.



When styling patterns become common across the application, extract them into shared components rather than duplicating classes.



Avoid unnecessary custom CSS unless Tailwind cannot reasonably achieve the desired result.



\---



\## Responsive Design



Every new feature should work well on both desktop and mobile.



Layouts should adapt naturally without requiring separate implementations whenever possible.



Responsiveness should be considered from the beginning rather than added later.



\---



\## Accessibility



Interfaces should be usable by as many people as possible.



When appropriate:



\- Use semantic HTML.

\- Associate labels with form controls.

\- Support keyboard navigation.

\- Provide meaningful alternative text for images.

\- Ensure sufficient color contrast.

\- Preserve visible focus states.



Accessibility should never be treated as an optional enhancement.



\---



\## Animations



Animations should improve understanding rather than attract attention.



Prefer subtle transitions that communicate:



\- state changes

\- loading

\- success

\- navigation

\- interaction feedback



Avoid excessive motion or decorative animations that distract from the user's content.



\---



\## Empty States



Empty states should encourage users to create their first Memory or continue building their story.



Avoid generic messages such as "No data found."



Every empty state should reinforce Avero's purpose.



\---



\## Design Consistency



Follow the existing spacing, typography, colors, border radius, shadows, icons, and interaction patterns.



If an existing component already solves a problem, reuse it instead of creating a visually different alternative.



Visual consistency is considered a product feature.

---



\# 10. Supabase \& Database Standards



Avero uses Supabase as its backend platform and PostgreSQL as its database.



User memories are valuable and must be treated with a strong emphasis on reliability, integrity, and security.



\## Source of Truth



The database schema is defined in `docs/database.md`.



AI assistants should not introduce new tables, columns, relationships, or constraints unless explicitly requested or reflected in the documentation.



\---



\## Data Integrity



When working with database operations:



\- Preserve referential integrity.

\- Avoid destructive schema changes.

\- Prefer migrations over manual database edits.

\- Do not delete or alter existing data unless explicitly instructed.



Protecting user data always takes priority over implementation speed.



\---



\## Authentication



Authentication should use Supabase Authentication.



Avoid implementing custom authentication flows unless explicitly requested.



Respect authentication and authorization boundaries throughout the application.



\---



\## Row Level Security (RLS)



Design all database interactions with Row Level Security in mind.



Never assume a client has unrestricted access to data.



Queries and mutations should respect ownership and access rules defined by the project.



\---



\## API Usage



Use the official `@supabase/supabase-js` client.



Avoid introducing unnecessary backend abstractions unless they provide clear architectural value.



Keep database queries simple, readable, and maintainable.



\---



\## Error Handling



Database operations should handle expected failures gracefully.



Do not expose internal database details or sensitive information to end users.



Provide meaningful user-facing messages while logging technical details where appropriate.



\---



\## Security



Never expose service role keys, secrets, or sensitive credentials in client-side code.



Environment variables should be used for configuration.



Security should always be considered during implementation, not added afterward.

---



\# 11. Documentation Standards



Documentation is considered part of the product, not an afterthought.



When making changes that affect architecture, behavior, or project decisions, AI assistants should determine whether the relevant documentation should also be updated.



\## Documentation First



Project documentation should accurately reflect the current state of the application.



Avoid allowing code and documentation to diverge.



\---



\## Respect Existing Documentation



Do not overwrite established project decisions without explicit approval.



If documentation conflicts with a requested implementation, highlight the conflict before making changes.



\---



\## Update Documentation When Appropriate



Consider updating documentation when changes affect:



\- Architecture

\- Folder structure

\- Database schema

\- Feature behavior

\- Design system

\- Engineering standards

\- Project workflow



Minor implementation details generally do not require documentation updates.



\---



\## Write Clearly



Documentation should be:



\- Concise

\- Consistent

\- Easy to navigate

\- Free of unnecessary technical jargon



Prefer clear explanations over exhaustive detail.



\---



\## Preserve Consistency



Use the same terminology throughout the project.



Always refer to core concepts using their documented names, such as:



\- User

\- Space

\- Memory

\- Media

\- Tag

\- Reaction

\- Comment

\- Location



Avoid introducing alternative terminology for existing concepts.

---



\# 12. What Never To Do



The following actions should never be performed unless explicitly requested.



\## Product



\- Do not add features that conflict with Avero's product philosophy.

\- Do not implement future roadmap items early.

\- Do not introduce social media mechanics such as followers, public feeds, trending content, or engagement-driven features.

\- Do not prioritize novelty over long-term value.



\---



\## Architecture



\- Do not introduce new frameworks or major dependencies without approval.

\- Do not replace existing architectural patterns with personal preference.

\- Do not duplicate existing functionality.

\- Do not create unnecessary abstraction.



\---



\## Code



\- Do not modify unrelated files.

\- Do not perform large refactors while implementing an unrelated task.

\- Do not leave dead code or unused imports.

\- Do not disable TypeScript checks to bypass errors.

\- Do not use `any` unless there is a compelling and approved reason.



\---



\## Database



\- Do not perform destructive database changes without approval.

\- Do not bypass Row Level Security.

\- Do not expose secrets, service role keys, or sensitive credentials.

\- Do not assume unrestricted access to user data.



\---



\## User Experience



\- Do not sacrifice accessibility for visual appearance.

\- Do not create inconsistent UI patterns.

\- Do not add unnecessary animations.

\- Do not increase complexity when a simpler solution exists.



\---



\## Documentation



\- Do not ignore existing documentation.

\- Do not invent project decisions that have not been documented or approved.

\- Do not allow implementation and documentation to drift apart without highlighting the discrepancy.



When uncertain, ask for clarification instead of making assumptions.

---



\# 13. Definition of Done



A task is considered complete only when all of the following conditions have been satisfied.



\## Product



\- The implementation aligns with Avero's vision and product philosophy.

\- The feature behaves as specified.

\- No unnecessary functionality has been added.



\---



\## Code Quality



\- The code is readable and maintainable.

\- Existing patterns and conventions have been followed.

\- No unnecessary complexity has been introduced.

\- Unused code and imports have been removed.



\---



\## User Experience



\- The interface is consistent with the design system.

\- The feature is responsive.

\- Accessibility has been considered where appropriate.

\- User feedback is provided for important actions.



\---



\## Reliability



\- Errors are handled appropriately.

\- Sensitive data remains protected.

\- Existing functionality has not been unintentionally broken.



\---



\## Documentation



\- Relevant documentation has been updated if necessary.

\- New terminology remains consistent with the Blueprint.



\---



\## Final Review



Before considering a task complete, verify:



\- The requested problem has been fully solved.

\- Only relevant files were modified.

\- The implementation follows this AI Context document.

\- The implementation follows the documentation inside `/docs`.



If any of these conditions are not satisfied, the task should not be considered complete.

