# Recipes

Example prompts that work well. Mix Persian and English freely.

## Price check

- «قیمت گوشی سامسونگ A55 چنده؟»
- "What does the cheapest iPhone 13 cost in Iran right now?"
- "Best wireless headphones under 2 million Toman"

## Timing the buy

- "Is 113 million Toman a good price for a used iPhone 13 Pro right now?"
- «الان وقت خوبیه برای خرید این؟»

→ Uses `product_price_chart` (verdict: great / fair / high).

## Trust the seller

- "Is this seller trustworthy? They're much cheaper than everyone else."
- «این فروشنده قابل اعتماده؟»

→ `product_sellers` then `shop_profile`.

## Local stock

- "Which shops in Shiraz have this in stock?"
- «کدوم فروشگاه‌های شیراز این رو موجود دارن؟»

→ `product_stores` with a `city` argument.

## Compare variants

- "Compare the 128GB and 256GB versions"
- «نسخه ۱۲۸ و ۲۵۶ گیگ رو مقایسه کن»

→ `product_variants` or `compare_products`.

## Habit worth keeping

Always ask for the **product URL**. Listings move; a link is the durable answer.
