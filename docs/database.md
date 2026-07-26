\# Avero Database Design



\*\*Version:\*\* 1.0

\*\*Status:\*\* 🟡 In Progress



\---



\# 1. Design Philosophy



The Avero database is built around one core idea:



> Everything exists to preserve shared memories inside Spaces.



We prioritize:



\* Simplicity

\* Strong relationships between data

\* Data integrity (no lost memories)

\* Scalability for future features



\---



\# 2. Core Entities Overview



Avero is built around 5 main entities:



\* Users

\* Spaces

\* Space Members

\* Memories

\* Media



Supporting entities:



\* Comments

\* Reactions

\* Tags



\---



\# 3. Users



Represents a person using Avero.



\### Fields:



\* id (UUID)

\* name

\* email

\* password\_hash / auth\_provider\_id

\* created\_at

\* avatar\_url (optional)



\---



\# 4. Spaces



A Space is a shared memory environment.



\### Fields:



\* id (UUID)

\* name

\* description (optional)

\* created\_by (user\_id)

\* created\_at



\---



\# 5. Space Members



Represents users inside a Space.



\### Fields:



\* id (UUID)

\* space\_id

\* user\_id

\* role (owner / member)

\* joined\_at



\---



\# 6. Memories



The core object of Avero.



\### Fields:



\* id (UUID)

\* space\_id

\* created\_by (user\_id)

\* title

\* description (optional)

\* memory\_type (side quest, trip, etc.)

\* location (optional string for MVP)

\* created\_at

\* memory\_date (when event happened)



\---



\# 7. Media



Photos and videos attached to Memories.



\### Fields:



\* id (UUID)

\* memory\_id

\* url

\* type (image / video)

\* created\_at



\---



\# 8. Comments



User-generated context for Memories.



\### Fields:



\* id (UUID)

\* memory\_id

\* user\_id

\* content

\* created\_at



\---



\# 9. Reactions



Emotional validation of Memories.



\### Fields:



\* id (UUID)

\* memory\_id

\* user\_id

\* type (❤️ 😂 🔥 🥹 👏 😮)

\* created\_at



\---



\# 10. Tags



Simple labels for organization.



\### Fields:



\* id (UUID)

\* name

\* space\_id (optional for future filtering)



\---



\# 11. Memory-Tags (Relation Table)



Many-to-many relationship.



\### Fields:



\* memory\_id

\* tag\_id



\---



\# 12. Key Relationships



\* Users belong to Spaces via Space Members

\* Spaces contain Memories

\* Memories contain Media

\* Memories have Comments + Reactions

\* Memories can have multiple Tags



\---



\# 13. Data Rules



\* A Memory must belong to exactly one Space

\* Media cannot exist without a Memory

\* Comments and Reactions cannot exist without a Memory

\* Users cannot access Spaces they are not members of



\---



\# 14. MVP Constraints



For MVP:



\* No real-time systems needed yet

\* No advanced analytics

\* No AI-generated data

\* No complex permissions beyond Space membership



\---



\# 15. Future Expansion (NOT MVP)



\* Echoes system

\* Maps

\* Memory stats

\* AI summaries

\* Advanced search indexing



