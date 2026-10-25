# Public Storefront Access Recheck

October 25, 2026. This is an access/source-evidence audit, not a successful
production crawl. The original goal remains open.

| Site | Fresh observation | Next requirement |
| --- | --- | --- |
| Brewing Ceremony | Public searches confirm the same Naver store but yield no usable direct product URLs. No security challenge was completed. | Obtain an accessible public listing/product response after the separately requested security-check confirmation, or an authorized merchant feed. |
| Coffee Aura | Its normal anonymous in-app browser session shows four coffees and 29 exact native options. Standard HTTP, HTML-header HTTP and two isolated browser probes all return 403. | Prove an automated access route before registering runtime support. Browser-only evidence is not an HTTP fix. |
| Single Origin espresso & roast | Its official Shopee destination redirects the anonymous browser to a traffic-error page that explicitly asks for sign-in. | An authorized working session or merchant-provided catalog source; cached search listings cannot prove current prices, stock or options. |
| 5F Coffee Lab | The current official EHIRIX homepage works and identifies the roastery behind the equipment. Its observed homepage links are internal equipment/contact anchors, not retail coffee listings. | Find and verify a separate retail coffee destination. This does not prove the roaster has no online store. |

## Aura Source Evidence

The live coffee category is
`https://auracoffee.stores.jp/?category_id=67fa483ec823279e7f4db66b`.
It exposes four products, rather than the older seven-product search snapshot:

- Aura Blend: eight options, native product `67a9967b7ae10400da93f5da`.
- Chiapas Decaf: seven options, `6811a5ef6270d00054369af0`.
- Mandheling Pollung Alfiner: seven options, `69aa891c827c0262a0446036`.
- Nigusse Gemeda Charcho Natural: seven options, `6ab1d3dd72b6d5e689ed3e84`.

These English labels identify the inspected products here; the actual merchant
titles are retained in `aura-browser-source-evidence.json`. This is not an
English-before-save translation or a catalog write.

The public product section embeds a literal array of native option IDs, names,
JPY amounts and quantities. Each rendered purchase row binds the same native
option object. The offline inspector verifies exact merchant/product/canonical
identity, coffee-category membership, all observed option IDs, displayed prices,
enabled same-SKU controls and aggregate min/max/count agreement. It does not
execute controller calls, add anything to a cart, invoke a model or load a DB
client. An aggregate minimum is never assigned to every option.

The exact sample option is 20g, while the blend's prose also mentions 30g.
The option label, not unrelated prose, supplies its net weight. Whole-bean and
ground 100g/200g options retain separate native IDs. Their later saves would
still require the pending same-weight native-SKU index approval.

Reproduce the evidence check, offline:

```sh
node scripts/inspect-stores-browser-capture.cjs \
  test/fixtures/siteSupport/aura-browser-source.json \
  /tmp/aura-browser-evidence.json
```

The projected fixture excludes account/session tokens and unrelated scripts.
The report explicitly sets `automated_http_supported: false` and
`production_ingest_verified: false`. No Aura runtime profile, browser transport
or browser dependency was shipped. The rejected isolated-browser experiment was
removed after its real 403 results; passing source checks do not override them.

## Runtime And Accounting

`public-access-route-recheck.json` contains the sanitized probes and per-site
classification. `post-access-recheck-readback.json` independently confirms 21
roaster owners and zero products at 11:07:50 UTC. These probes made no production
writes or model calls. The prior API-credit failure and the separate global
variant-index approval are still unresolved.

The Mac mini SSH connection to `allan@10.0.0.232` timed out in this recheck.
Its current checkout/PID/schedule were therefore not revalidated; no source,
schema, dependency, scheduler or service change was made there. The existing
Instagram discovery session is still waiting for access approval, not terminal.

Automated merchant extraction remains **348 products from fifteen sites**.
Aura's four manually captured products and 29 options are recorded separately,
not added to that total. Newly saved coffees remain **zero**. The full current
regression suite contains 621 tests; the seven new tests cover source evidence
and intentionally do not claim working automated access.
