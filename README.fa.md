<div dir="rtl" lang="fa">

# torob-mcp

**سرور MCP برای [ترب](https://torob.com)، موتور مقایسه قیمت ایران.**
از دستیار هوش مصنوعی‌تان بپرسید یک کالا چند است، ارزان‌ترین فروشنده کیست، الان وقت خوبی برای خرید
هست یا نه، و آیا فروشگاه قابل اعتماد است.

[![CI](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/torob-mcp)](https://www.npmjs.com/package/torob-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md)

> **غیررسمی.** این پروژه هیچ وابستگی، تأییدیه یا ارتباطی با ترب ندارد. یک کلاینت مستقل برای همان
> endpointهای JSON است که وب‌سایت ترب خودش استفاده می‌کند. این endpointها ممکن است بدون اطلاع قبلی
> تغییر کنند یا از کار بیفتند. تمام قیمت‌ها از ترب می‌آید و همان‌طور که هست گزارش می‌شود.

---

## چه کاری انجام می‌دهد

پانزده ابزار برای جست‌وجو، قیمت، فروشنده‌ها، تاریخچه قیمت، فروشگاه‌های حضوری و اعتبار فروشگاه.
قیمت‌ها به **تومان** نرمال‌سازی می‌شوند. جست‌وجو با فارسی، انگلیسی و فینگلیش کار می‌کند — مثلاً
`ayfon 13` همان چیزی را پیدا می‌کند که انتظار دارید.

```
شما:  ارزون‌ترین آیفون ۱۳ توی ایران الان چنده؟ وقت خوبیه برای خرید؟

→ search_torob(query: "iPhone 13")
→ product_price_chart(product_id: …)   verdict: "great" — صدک ۲۵ در ۱۲ هفته
→ product_sellers(product_id: …)       ارزان‌ترین فروشنده قابل‌اعتماد، ★۵
```

## نصب

به **Node 22 یا بالاتر** نیاز دارد.

### Claude Code

```bash
claude mcp add torob -- npx -y torob-mcp
```

### Claude Desktop

مسیر فایل پیکربندی:
`~/Library/Application Support/Claude/claude_desktop_config.json` در macOS،
`%APPDATA%\Claude\claude_desktop_config.json` در Windows:

```json
{
  "mcpServers": {
    "torob": {
      "command": "npx",
      "args": ["-y", "torob-mcp"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` در پروژه، یا `~/.cursor/mcp.json` به‌صورت سراسری:

```json
{
  "mcpServers": {
    "torob": {
      "command": "npx",
      "args": ["-y", "torob-mcp"]
    }
  }
}
```

### بدون نصب امتحان کنید

```bash
npx -y torob-mcp --help
npx -y @modelcontextprotocol/inspector npx -y torob-mcp
```

## ابزارها

| ابزار                 | کاربرد                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `search_torob`        | جست‌وجو با فیلتر دسته، برند، بازه قیمت، وضعیت و مرتب‌سازی              |
| `torob_suggest`       | تبدیل عبارت مبهم، غلط املایی یا فینگلیش به عبارت قابل جست‌وجو          |
| `product_details`     | بازه قیمت، تعداد فروشنده، مشخصات فنی، مسیر دسته‌بندی                   |
| `product_sellers`     | فروشنده‌ها به ترتیب ارزان‌ترینِ قابل‌اعتماد، همراه با نشانه‌های اعتبار |
| `product_price_chart` | حدود یک سال قیمت هفتگی و داوری: عالی / منصفانه / بالا                  |
| `product_variants`    | نسخه‌های دیگر (حافظه، رم، ریجن) با قیمت هرکدام                         |
| `similar_products`    | فهرست «مشابه» خود ترب                                                  |
| `product_stores`      | فروشگاه‌های حضوری، با امکان فیلتر بر اساس شهر                          |
| `shop_profile`        | شهر، امتیاز، وضعیت نماد اعتماد و سابقه فروشگاه در ترب                  |
| `browse_category`     | مرور یک دسته‌بندی کامل به‌جای جست‌وجو                                  |
| `search_filters`      | یافتن شناسه دسته‌بندی، شناسه برند و بازه قیمت                          |
| `compare_products`    | مقایسه ۲ تا ۵ محصول و نمایش فقط تفاوت‌ها                               |
| `find_best_value`     | «بهترین X زیر Y تومان»، رتبه‌بندی‌شده                                  |
| `get_products_batch`  | کارت اطلاعات تا ۱۰ محصول به‌صورت یکجا                                  |
| `product_url`         | ساخت لینک قابل اشتراک ترب (بدون درخواست به سرور)                       |

## نمونه پرسش‌ها

- «قیمت گوشی سامسونگ A55 چنده؟»
- «بهترین هدفون بی‌سیم زیر ۲ میلیون تومان»
- «الان ۱۱۳ میلیون برای آیفون ۱۳ پرو کارکرده قیمت خوبیه؟»
- «کدوم فروشگاه‌های شیراز این رو موجود دارن؟»
- «نسخه ۱۲۸ و ۲۵۶ گیگ رو مقایسه کن»
- «این فروشنده قابل اعتماده؟ خیلی از بقیه ارزون‌تره.»

چون قیمت‌ها مدام تغییر می‌کنند، بهتر است از دستیار بخواهید لینک محصول را هم بدهد.

## حالت ریموت (HTTP)

```bash
torob-mcp --http                      # 127.0.0.1:3000
torob-mcp --http --port 8080
torob-mcp --http --host 0.0.0.0       # نیاز به TOROB_AUTH_TOKEN
```

- به‌صورت پیش‌فرض روی **loopback** bind می‌شود.
- bind غیرمحلی **نیازمند** `TOROB_AUTH_TOKEN` (حداقل ۱۶ کاراکتر) است، مگر با `--insecure`.
- Origin و Host اعتبارسنجی می‌شوند (محافظت در برابر DNS rebinding)؛ CORS با wildcard نیست.
- `GET /healthz` هیچ درخواست بالادستی نمی‌زند. `POST /mcp` همان transport است.

## پیکربندی

همه چیز اختیاری است و در شروع اعتبارسنجی می‌شود. نمونه: [`.env.example`](.env.example).

| متغیر                   | پیش‌فرض                     | کاربرد                                                         |
| ----------------------- | --------------------------- | -------------------------------------------------------------- |
| `TOROB_LOG_LEVEL`       | `info`                      | متن جست‌وجو فقط در `debug` لاگ می‌شود، نه در `info`. فقط stderr. |
| `TOROB_USER_AGENT`      | `torob-mcp/<v> (+repo url)` | روی هر درخواست ارسال می‌شود. صادقانه نگه دارید.                |
| `TOROB_CONCURRENCY`     | `3`                         | درخواست‌های همزمان به ترب (۱–۴).                               |
| `TOROB_RATE_PER_SEC`    | `4`                         | محدودیت نرخ (token bucket) در برابر ترب.                       |
| `TOROB_TTL_SEARCH_S`    | `300`                       | کش جست‌وجو. محصول `900`، نمودار قیمت `21600`.                  |
| `TOROB_AUTH_TOKEN`      | —                           | توکن Bearer برای حالت HTTP. برای bind غیرمحلی اجباری است.      |
| `TOROB_ALLOWED_ORIGINS` | —                           | لیست Originهای مجاز، جدا با ویرگول. خالی = رد همه Originها.    |

## استقرار

> **⚠️ ترب بسیاری از IPهای سرورهای ابری را مسدود می‌کند.** این محتمل‌ترین دلیل شکست استقرار است.
> Cloudflare Workers و محدوده‌های دیتاسنتری AWS، GCP، Azure، Hetzner، DigitalOcean و دیگران اغلب
> مسدود می‌شوند یا به‌جای JSON صفحه چالش می‌گیرند. سرور این وضعیت را با خطای `Blocked` گزارش
> می‌کند و معلق نمی‌ماند.
>
> **یک سرور مجازی ایرانی یا اینترنت خانگی در ایران گزینه مطمئن است.** پیش از تکیه بر هر گزینه
> دیگری، با `pnpm test:live` روی همان میزبان آن را آزمایش کنید.

راهنمای کامل Docker، VPS ایرانی، Fly.io و Railway: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## مدل امنیتی

طراحی بر این فرض است که روی **ماشین شما** اجرا می‌شود و خروجی‌اش وارد context پنجره یک LLM می‌شود.
جزئیات: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

- **فهرست میزبان مجاز.** فقط `torob.com` و `api.torob.com` — در **هر hop ریدایرکت** دوباره بررسی
  می‌شود. شناسه محصول قبل از ساخت URL به‌عنوان UUID اعتبارسنجی می‌شود.
- **بهداشت prompt injection.** عنوان و یادداشت فروشنده متن شخص ثالث است: کاراکترهای کنترلی،
  بازنویسی جهت (bidi) و کاراکترهای بدون عرض حذف می‌شوند — به‌جز نیم‌فاصله که در فارسی معنادار
  است. **ریسک را کم می‌کند، حذف نمی‌کند**؛ محافظت واقعی این است که سرور کاملاً فقط‌خواندنی است.
- **آگهی‌های اسپانسری** با `sponsored: true` مشخص می‌شوند و پنهان نمی‌مانند.
- **پروفایل فروشگاه allowlist است.** از حدود ۷۲ فیلد بالادستی حدود ۱۵ فیلد منتشر می‌شود.
- **بدون تله‌متری، بدون کوکی، بدون ذخیره روی دیسک.** کش فقط در حافظه است.

## چه چیزی به ترب فرستاده می‌شود

فقط آنچه ابزار لازم دارد: **متن جست‌وجو** (نرمال‌شده)، **شناسه‌ها و فیلترها**، صفحه و اندازه،
User-Agent ما، و ناگزیر **آدرس IP** شما. یک استثنا هدر مشتق‌شده `deliver_city` دارد:
`product_stores` با آرگومان `city`.

**بدون تله‌متری، بدون آنالیتیکس، بدون ماندگاری روی دیسک، بدون cookie jar.** جزئیات:
[`docs/PRIVACY.md`](docs/PRIVACY.md).

## توسعه

```bash
pnpm install --frozen-lockfile
pnpm check          # oxlint + oxfmt + typecheck
pnpm test           # تست‌های آفلاین و قطعی
pnpm test:live      # اختیاری؛ به API واقعی می‌زند
pnpm build
pnpm inspect        # MCP Inspector
```

راهنما: [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## مستندات

[ویکی](wiki/fa/Home.md) ·
[فهرست docs](docs/README.md) ·
[Endpointها](docs/ENDPOINTS.md) ·
[معماری](docs/ARCHITECTURE.md) ·
[مدل تهدید](docs/THREAT_MODEL.md) ·
[حریم خصوصی](docs/PRIVACY.md) ·
[استقرار](docs/DEPLOY.md) ·
[وابستگی‌ها](docs/DEPENDENCIES.md) ·
[سیاست امنیتی](SECURITY.md)

راهنماهای کاربری در [`wiki/`](wiki/Home.md) هستند؛ مرجع فنی عمیق در [`docs/`](docs/README.md).

## مجوز

MIT © سیامک مختاری

</div>
