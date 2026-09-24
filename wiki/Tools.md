# Tools

Fifteen tools. Prices are **Toman**. Persian, English and Finglish queries all work (`ayfon 13` is fine).

| Tool                  | What it answers                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| `search_torob`        | "What does X cost?" — query plus category, brand, price range, condition and sort |
| `torob_suggest`       | Vague, misspelled or Finglish → phrases that work                                 |
| `product_details`     | Price range, seller count, specs, category path                                   |
| `product_sellers`     | Who sells it, cheapest-reliable-first, with trust signals                         |
| `product_price_chart` | ~a year of weekly prices + verdict: great / fair / high                           |
| `product_variants`    | Storage, RAM and region siblings with their own prices                            |
| `similar_products`    | Torob's own "similar" list                                                        |
| `product_stores`      | Physical shops, filterable by city                                                |
| `shop_profile`        | City, score, enamad trust seal, time on Torob                                     |
| `browse_category`     | Browse a whole category rather than searching                                     |
| `search_filters`      | Discover category ids, brand ids and the price span                               |
| `compare_products`    | 2–5 products side by side, showing only what differs                              |
| `find_best_value`     | "Best X under Y Toman", ranked                                                    |
| `get_products_batch`  | Cards for up to 10 ids at once                                                    |
| `product_url`         | A shareable torob.com link (costs no request)                                     |

## Typical flow

```
search_torob → product_price_chart → product_sellers → product_url
```

Ask the model to include the product URL — prices move constantly.

Sponsored placements are labelled `sponsored: true`. Merchant text is third-party data (sanitized, but still untrusted).
