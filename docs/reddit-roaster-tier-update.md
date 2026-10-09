# Reddit roaster tier update, October 9, 2026

The user assigned the twelve confirmed untiered roasters from the Reddit audit to tier two, except Hawaiian roasters to tier three. This adds ten tier-two IDs and three tier-three IDs, including an explicit Maui Origin identity. Big Island and Paradise remain tier three. Every prior crawler assignment is preserved, including all 65 tier-one IDs, Preface, and all nine exclusion IDs.

Tier two: Brass Horn, Dessert Oasis, Four Letter Word, FRINJ, Gaslight, Isotope, Milk & Honey, Pastime, Pure Intentions and Rosso.

Tier three additions: ChadLou's, Hawaiian GOAT (now Namvar Estates), and Origin Coffee Roasters on Maui. Namvar's official homepage confirms the rebrand; only one catalog identity was created. Isotope's official micro-roaster website was also verified before creating its minimal catalog record. “Ipswich” and “Good Roasters” remain unresolved; the generic UK/Maui Origin source entry remains unresolved independently of the explicit Maui assignment.

Source: `allang/everycoffee` commit `971505f3cfe3841716ee7e297ab0d43d27bca3b4`, `data/pourover-roaster-assessment.csv` and `data/reddit-roaster-tier-assignments.json`. The expanded source has 889 unique names, with 65/46/767/0/11 names by tier. The crawler's reviewed stable-ID manifest has 537 IDs, with 65/42/421/0/9 by tier. Its hash points to the full reviewed `data/roaster-tier-import/mapping.json` in the source review branch.

Production has no typed `entities.roaster_tier` column, so the crawler continues to use the reviewed ID fallback. The production tier representation is `entity_attributes.roaster_tier`; thirteen values and thirteen provenance attributes were inserted transactionally. Two minimal verified entities and roaster roles were created. Eleven existing entity rows, all existing roles, locations and unrelated attributes were unchanged. No product or schema changes were made. A live repeat changed zero rows.

The guarded SQL was tested for rollback, apply, repeat, preserving existing rows and rejecting changed websites, missing roles, conflicting manual tiers, canonical aliases, duplicate official domains and duplicate names. A production rollback preview and committed readback passed. All 487 crawler tests passed under Node 24.19.0, including isolated native PostgreSQL checks; all thirteen focused tier/query tests passed. Crawler tests cover the deployed schema fallback and confirm these roasters appear in their assigned phase before remaining roasters, while UK Origin remains a separate unassigned ID.
