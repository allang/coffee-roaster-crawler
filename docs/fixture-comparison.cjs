module.exports = {
  "observed_at": "2026-10-06T13:54:30.935Z",
  "baseline_commit": "98f5aeaceea95016f0d5f7a1131ad71867d5c3c2",
  "scope": "Offline deterministic money/availability fixtures; actual application functions, simulated database transport; not a representative merchant sample",
  "money": {
    "cases": 8,
    "before_correct": 3,
    "after_correct": 8,
    "details": [
      {
        "raw": "12,00€",
        "expected": {
          "minorUnits": 1200,
          "currency": "EUR"
        },
        "before": {
          "storedPrice": 1200,
          "currency": "USD"
        },
        "after": {
          "minorUnits": 1200,
          "currency": "EUR"
        },
        "before_correct": false,
        "after_correct": true
      },
      {
        "raw": "EUR 1.234,56",
        "expected": {
          "minorUnits": 123456,
          "currency": "EUR"
        },
        "before": {
          "storedPrice": 123456,
          "currency": "EUR"
        },
        "after": {
          "minorUnits": 123456,
          "currency": "EUR"
        },
        "before_correct": true,
        "after_correct": true
      },
      {
        "raw": "USD 1,234.56",
        "expected": {
          "minorUnits": 123456,
          "currency": "USD"
        },
        "before": {
          "storedPrice": 123456,
          "currency": "USD"
        },
        "after": {
          "minorUnits": 123456,
          "currency": "USD"
        },
        "before_correct": true,
        "after_correct": true
      },
      {
        "raw": "1200",
        "expected": {
          "minorUnits": 1200,
          "currency": "JPY"
        },
        "before": {
          "storedPrice": 120000,
          "currency": "JPY"
        },
        "after": {
          "minorUnits": 1200,
          "currency": "JPY"
        },
        "before_correct": false,
        "after_correct": true
      },
      {
        "raw": "1.234",
        "expected": {
          "minorUnits": 1234,
          "currency": "KWD"
        },
        "before": {
          "storedPrice": null,
          "currency": "KWD"
        },
        "after": {
          "minorUnits": 1234,
          "currency": "KWD"
        },
        "before_correct": false,
        "after_correct": true
      },
      {
        "raw": "$12.00",
        "expected": {
          "minorUnits": null,
          "currency": null
        },
        "before": {
          "storedPrice": 1200,
          "currency": "USD"
        },
        "after": {
          "minorUnits": null,
          "currency": null
        },
        "before_correct": false,
        "after_correct": true
      },
      {
        "raw": "12.50",
        "expected": {
          "minorUnits": 1250,
          "currency": "EUR"
        },
        "before": {
          "storedPrice": 1250,
          "currency": "EUR €"
        },
        "after": {
          "minorUnits": 1250,
          "currency": "EUR"
        },
        "before_correct": false,
        "after_correct": true
      },
      {
        "raw": "140 Kč – 1250 Kč",
        "expected": {
          "minorUnits": null,
          "currency": "CZK"
        },
        "before": {
          "storedPrice": null,
          "currency": "CZK"
        },
        "after": {
          "minorUnits": null,
          "currency": "CZK"
        },
        "before_correct": true,
        "after_correct": true
      }
    ]
  },
  "availability": {
    "cases": 7,
    "before_correct": 2,
    "after_correct": 7,
    "details": [
      {
        "name": "empty HTML",
        "expected": "unknown",
        "before": "sold_out",
        "after": "unknown",
        "before_correct": false,
        "after_correct": true
      },
      {
        "name": "price only",
        "expected": "unknown",
        "before": "sold_out",
        "after": "unknown",
        "before_correct": false,
        "after_correct": true
      },
      {
        "name": "unscoped buy button",
        "expected": "unknown",
        "before": "in_stock",
        "after": "unknown",
        "before_correct": false,
        "after_correct": true
      },
      {
        "name": "missing Shopify stock flag",
        "expected": "unknown",
        "before": "sold_out",
        "after": "unknown",
        "before_correct": false,
        "after_correct": true
      },
      {
        "name": "primary sold-out plus related in-stock",
        "expected": "sold_out",
        "before": "in_stock",
        "after": "sold_out",
        "before_correct": false,
        "after_correct": true
      },
      {
        "name": "exact Shopify in stock",
        "expected": "in_stock",
        "before": "in_stock",
        "after": "in_stock",
        "before_correct": true,
        "after_correct": true
      },
      {
        "name": "removed URL",
        "expected": "removed",
        "before": "removed",
        "after": "removed",
        "before_correct": true,
        "after_correct": true
      }
    ]
  },
  "elapsed_ms": 87.867,
  "actual_paid_ai_requests": 0,
  "actual_paid_ai_tokens": 0,
  "production_crawl_duration": null,
  "production_cost_change": null
};
