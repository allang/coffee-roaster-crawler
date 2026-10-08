# Prepared tier 2 catalog repairs

These three changes would let the verified merchants enter normal crawler selection. They are prepared for review; no production records have changed.

| Merchant | Proposed change | Verified evidence |
| --- | --- | --- |
| Apiary Coffee Co. | Add a new record at `https://apiary.coffee/`, with slug `apiary-coffee-co` and roaster classification. | No catalog name, website or slug match. Its [official about page](https://apiary.coffee/pages/about) describes its own roasting. Six coffees and six variants passed the merchant inspection. No address is invented. |
| Passport Specialty Coffee | Add a new record at `https://passportcoffee.com.au/`, with slug `passport-specialty-coffee` and roaster classification. Address: 49 Toombul Rd, Northgate 4013, Brisbane, Australia. | The [official store](https://passportcoffee.com.au/) identifies the roastery and street address. Its 255 coffees and 529 variants passed inspection. The existing Passport namesakes have incompatible locations and are preserved. |
| Colorfull Coffee | Add roaster classification to its existing record. Preserve every existing business field. | The exact website matches the catalog record. Its [official about page](https://colorfullcoffee.com/pages/about) identifies a coffee roasting company. Fourteen coffees and 27 variants passed inspection. |

Before any approved write, recheck current identities and slug collisions. Reuse an exact record created by an interrupted prior operation, add a missing classification only once, and stop on competing identities. New IDs must come from the database.

Your original instruction prohibited production writes, and the handoff says “Do not create entities.” Applying these changes needs an explicit exception. Aery's new entry and the photo repair remain separate pending decisions. The Mac mini update still requires resolution of all tier 1 and missing tier 2 products, including .txt's missing public option IDs.

The exact reviewed fields and catalog evidence are in [catalog-repair-proposals.json](catalog-repair-proposals.json).
