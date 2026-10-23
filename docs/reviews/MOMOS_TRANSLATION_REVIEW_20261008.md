# Momos translation review — 2026-10-08

**Prepared only: zero catalog writes and zero source installations.** Candidate **d5362fe6f7859e955b7f0f3546c82bd8543742e2** in [PR #12](https://github.com/allang/coffee-roaster-crawler/pull/12) was run from the separate verification checkout using the Mac Mini's existing configured model. Eight focused translation/SQL tests passed, with zero failures/skips. Both exact candidate CI checks passed. The coordinating thread must review the plan before any application or merge.

The first 24 model responses were generated on 058a3b2, then reused by exact source bundle without new paid calls. The remaining seven were generated on d3688a1. All 31 were finally revalidated on d5362fe, which resolves the adjacent-pack false rejection and decimal factor-of-ten false acceptance recorded in [PR #12](https://github.com/allang/coffee-roaster-crawler/pull/12#issuecomment-6070615664). The original failed run and response ledger remain private and unchanged.

The frozen Momos snapshot contains **31 products /129 variants /31 facts**, owner **c2941ba0-1481-4b69-b800-0d911f2797c3**, read at **2026-10-08T22:25:33.568Z**. All 31 records passed the candidate's field-ID, English-script and numeric-token checks. Source-language counts: **{'ko': 25, 'en': 6}**. All six records reported as English retain every submitted text unchanged.

Original title text stays in original_title. Merchant text and HTML stay in description_raw and description_html. The private plan retains original attributes, option labels, language and raw fact/tasting-note values under metadata._translation. Proposed display names, descriptions, summaries and descriptive attributes are English. Only text fields and translation metadata are proposed; fact changes are limited to the exact Washed, Anaerobic Natural and Geisha glossary. All 31 product IDs and 129 option IDs are retained. Slugs, source identity, prices, currencies, weights, stock, observation timestamps and photos have no proposed changes. Original full snapshots and original metadata remain private. The published JSON is a review document, not an executable apply file.

Actual model usage, including recovery: **40 requests /28130 input tokens /132852 output tokens**. Cached input: **2944**. Reasoning tokens included in output: **118560**. Output-limit recovery requests: **9**. Unreported request usage: **0**. These are measurements, not an invoice charge or a projection for a larger catalog.

| Original Korean title | Proposed English title |
|---|---|
| 콜드브루 RTD 235ml | Cold Brew RTD 235ml |
| 캡슐 골라담기 (60개) | Capsule assortment (60 ea) |
| 스페셜티 커피믹스 100개입 | Specialty Coffee Mix 100-pack |
| 캡슐 에스쇼콜라 (10개입) | Capsule Esschocola (10-pack) |
| 드립백 모모스커피 피카 테이블 부산 | Drip Bag Momos Coffee Pica Table Busan |
| 캡슐 므쵸베리 (10개입) | Meuchyo Berry Capsules (10-pack) |
| 원두 콜롬비아 라 구아두아 게이샤 워시드 | Coffee beans — Colombia La Guadua Geisha Washed |
| 캡슐 대용량 디카페인(100개입) | Capsule Large-capacity Decaffeinated (100 ea) |
| 캡슐 부산 (10개입) | Capsule Busan (10 pieces) |
| 콜드브루 원액 에티오피아 500ml | Cold Brew Concentrate Ethiopia 500ml |
| 콜드브루 RTD 2종 세트(10개입) | Cold Brew RTD 2-type set (10 ea) |
| 캡슐 대용량 에스쇼콜라 (100개입) | Bulk Es Shocola Capsules (100 ea) |
| 캡슐 디카페인 (10개입) | Decaffeinated Capsules (10 ea) |
| 모모스커피 콜드브루 원액 500ml | Momos Coffee Cold Brew Concentrate 500ml |
| 드립백 시그니처블렌드 28개입 | Drip Bag Signature Blend 28-pack |
| 캡슐 대용량 부산(100개입) | Capsule Large Pack Busan (100 capsules) |
| 콜드브루 원액 디카페인 500ml | Decaffeinated Cold Brew Concentrate 500ml |
| 드립백 대용량 시그니처 블렌드 100개입 | Large-capacity drip bag Signature Blend 100 ea |
| 드립백 대용량 시그니처 블렌드 50개입 | Drip bag large-capacity Signature Blend 50-pack |
| 드립백 달항아리 선물세트 24개입 | Drip Bag Dalhangari Gift Set 24-piece |
| 원두 에티오피아 사포 모스토 무산소 내추럴 | Coffee beans Ethiopia Sapo Mosto Anaerobic natural |
| 캡슐 대용량 므쵸베리(100개입) | Large-capacity Meuchyo Berry Capsules (100 ea) |
| 드립백 7개입 | Drip bag 7-pack |
| 콜드브루 RTD 디카페인 235ml | Cold Brew RTD Decaffeinated 235ml |
| 콜드브루 RTD 에티오피아 235ml | Cold Brew RTD Ethiopia 235ml |

The [sanitized review plan](momos-translation-review-20261008.json) contains all 31 text proposals, all 129 option mappings, source hashes and expected original update timestamps. Before applying, recheck the complete frozen row/child values and current Momos worker ownership. Do not overwrite later observations. A read-only check during preparation confirmed the frozen products and returned variant/fact/media values unchanged; the current worker was on Coffee Collective. The sole Momos row marked running dates to May 25 and was preserved.

The running crawler's source and configuration were not changed. Native-weight and typed-processing migrations remain unapplied. The canceled hourly heartbeat stays paused. No inventory crawl, deployment or purchase was started by this preparation.
