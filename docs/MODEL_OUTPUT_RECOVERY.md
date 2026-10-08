# Bounded classification recovery

The normal Passport and Colorfull crawls exposed empty model replies. The classifier now records the response finish reason and reported token totals. A reply ending because of its token limit is retried once with the same model and prompt; the default per-request allowance grows from 2,000 to 8,000. Already larger explicit limits are preserved. A second truncated result fails the page, even if its partial text parses as JSON. Completed empty replies, malformed JSON, refusals, filtered replies and authentication errors stay failures.

All reported token use from both requests is summed, including cached input and reasoning tokens. Unreported calls are kept distinct. A retry does not affect native product/variant identities, price/currency/stock evidence, image verification, cache reuse or omission safeguards.

The output limit includes both visible and reasoning tokens, as documented in the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [token-counting guide](https://developers.openai.com/api/docs/guides/token-counting). The initial configured model and request allowance are unchanged; recovery is conditional and bounded.
