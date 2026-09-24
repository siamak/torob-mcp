/**
 * Tool registration and the single error mapping.
 *
 * Every tool description is written as a prompt: when to reach for it, and what to call next.
 * Tools that return merchant-authored text carry the third-party notice, because their output is
 * read by a model that can call other tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Runtime } from '../runtime.ts';
import { TorobError } from '../torob/errors.ts';
import { priceChartInput, runPriceChart, runSuggest, suggestInput } from './insight.ts';
import {
  compareProductsInput,
  getProductsBatchInput,
  productDetailsInput,
  productUrlInput,
  productVariantsInput,
  runCompareProducts,
  runGetProductsBatch,
  runProductDetails,
  runProductUrl,
  runProductVariants,
  runSimilarProducts,
  similarProductsInput,
} from './product.ts';
import {
  findBestValueInput,
  runFindBestValue,
  runSearch,
  runSearchFilters,
  searchFiltersInput,
  searchInput,
} from './search.ts';
import {
  productSellersInput,
  productStoresInput,
  runProductSellers,
  runProductStores,
  runShopProfile,
  shopProfileInput,
} from './sellers.ts';
import { THIRD_PARTY_NOTICE } from './shared.ts';

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/**
 * The one place a TorobError becomes an MCP error.
 *
 * Only the actionable hint crosses this boundary. Stack traces, zod issue paths and upstream
 * message bodies stay in debug logs.
 */
function toMcpError(runtime: Runtime, tool: string, error: unknown): ToolResult {
  if (error instanceof TorobError) {
    runtime.log.debug('tool error', {
      tool,
      kind: error.kind,
      endpoint: error.endpoint,
      detail: error.detail,
    });
    return { content: [{ type: 'text', text: `${error.kind}: ${error.hint}` }], isError: true };
  }

  runtime.log.error('unexpected tool failure', {
    tool,
    name: error instanceof Error ? error.name : 'unknown',
  });
  return {
    content: [
      {
        type: 'text',
        text: 'Upstream: something went wrong inside torob-mcp - this is a bug, please report it',
      },
    ],
    isError: true,
  };
}

function wrap<A>(
  runtime: Runtime,
  tool: string,
  handler: (args: A) => Promise<unknown>,
): (args: A) => Promise<ToolResult> {
  return async (args: A): Promise<ToolResult> => {
    const started = runtime.now();
    try {
      const value = await handler(args);
      runtime.log.info('tool ok', { tool, ms: runtime.now() - started });
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch (error) {
      return toMcpError(runtime, tool, error);
    }
  };
}

/**
 * Registers all fifteen tools against an MCP server.
 *
 * Runtime-agnostic: the same call wires up the stdio server in apps/node and the Worker handler in
 * apps/worker.
 */
export function registerTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'search_torob',
    {
      title: 'Search Torob',
      description: `Search torob.com, Iran's price-comparison engine, for products and their cheapest prices across Iranian online shops. Use this whenever someone asks what something costs in Iran, where to buy it, or what is available under a budget. Prices are in Toman. If the query is vague, misspelled, or written in Finglish (Persian typed in Latin letters), call torob_suggest first. To narrow by category or brand, call search_filters to get the ids. Follow up with product_details for one product, or product_sellers to see individual offers. ${THIRD_PARTY_NOTICE}`,
      inputSchema: searchInput,
    },
    wrap(runtime, 'search_torob', (args) => runSearch(runtime, args, 'search_torob')),
  );

  server.registerTool(
    'torob_suggest',
    {
      title: 'Suggest Torob search phrases',
      description:
        'Turn a vague, misspelled, or Finglish query into search phrases that actually return results on Torob. Use this before search_torob whenever the user’s wording is uncertain, transliterated ("ayfon", "lab tap"), or returns nothing. Returns Torob’s own autocomplete phrases plus its spelling correction. Pass one of the returned phrases to search_torob.',
      inputSchema: suggestInput,
    },
    wrap(runtime, 'torob_suggest', (args: { query: string }) => runSuggest(runtime, args.query)),
  );

  server.registerTool(
    'product_details',
    {
      title: 'Torob product details',
      description: `Full detail for one Torob product: cheapest and highest current price, how many shops carry it, specifications, and where it sits in Torob’s category tree. Use after search_torob when the user asks about a specific product. Call product_sellers for who is selling it, product_price_chart for whether now is a good time to buy, or product_variants for other storage and colour options. ${THIRD_PARTY_NOTICE}`,
      inputSchema: productDetailsInput,
    },
    wrap(runtime, 'product_details', (args: { product_id: string }) =>
      runProductDetails(runtime, args.product_id),
    ),
  );

  server.registerTool(
    'product_sellers',
    {
      title: 'Torob sellers for a product',
      description: `Every online shop selling one product, ranked cheapest-reliable-first with trust signals: shop score, Torob’s order-history summary, warranty, and a price_unreliable flag Torob raises on suspiciously low listings. Use this before recommending any specific purchase - the cheapest listing is often not the safest. Call shop_profile on a shop_id for its full trust record. ${THIRD_PARTY_NOTICE}`,
      inputSchema: productSellersInput,
    },
    wrap(runtime, 'product_sellers', (args) => runProductSellers(runtime, args)),
  );

  server.registerTool(
    'product_price_chart',
    {
      title: 'Torob price history',
      description:
        'About a year of weekly minimum and average prices for one product, plus a verdict on whether the current cheapest price is great, fair, or high. Use whenever someone asks if now is a good time to buy, whether a price is reasonable, or how a price has moved. The verdict compares today against the last 12 weeks only, because Iranian prices inflate quickly - say so when reporting it.',
      inputSchema: priceChartInput,
    },
    wrap(runtime, 'product_price_chart', (args: { product_id: string }) =>
      runPriceChart(runtime, args.product_id),
    ),
  );

  server.registerTool(
    'product_variants',
    {
      title: 'Torob product variants',
      description:
        'Sibling versions of one product - storage size, RAM, and regional variants - each with its own product_id and cheapest price. Use when the user asks about a different capacity or configuration, or to check whether a larger model costs meaningfully more. Pass any returned product_id to product_details or product_sellers.',
      inputSchema: productVariantsInput,
    },
    wrap(runtime, 'product_variants', (args: { product_id: string }) =>
      runProductVariants(runtime, args.product_id),
    ),
  );

  server.registerTool(
    'similar_products',
    {
      title: 'Similar products on Torob',
      description: `Torob’s own list of products similar to one you already have. Use to widen a search when the exact product is too expensive, out of stock, or when the user wants alternatives to compare. Feed two to five of the returned ids into compare_products. ${THIRD_PARTY_NOTICE}`,
      inputSchema: similarProductsInput,
    },
    wrap(runtime, 'similar_products', (args) => runSimilarProducts(runtime, args)),
  );

  server.registerTool(
    'product_stores',
    {
      title: 'Physical shops stocking a product',
      description: `Bricks-and-mortar shops in Iran that stock one product, with their city, price, and whether they are open right now. Use when the user wants to buy in person, asks about their own city, or distrusts online sellers. Pass a Persian city name to filter; without one Torob answers for Tehran. ${THIRD_PARTY_NOTICE}`,
      inputSchema: productStoresInput,
    },
    wrap(runtime, 'product_stores', (args) => runProductStores(runtime, args)),
  );

  server.registerTool(
    'shop_profile',
    {
      title: 'Torob shop profile',
      description: `Trust record for one Torob shop: city, score, how long it has been on Torob, and its enamad status - Iran’s official e-commerce trust seal, which is the single strongest signal that a shop is legitimate. Use before recommending a purchase from an unfamiliar seller, especially when its price is far below the others. ${THIRD_PARTY_NOTICE}`,
      inputSchema: shopProfileInput,
    },
    wrap(runtime, 'shop_profile', (args: { shop_id: number }) =>
      runShopProfile(runtime, args.shop_id),
    ),
  );

  server.registerTool(
    'browse_category',
    {
      title: 'Browse a Torob category',
      description: `Browse one Torob category without a search query - the whole catalogue for that category, filterable and sortable. Use when the user wants to explore ("show me gaming laptops") rather than search for a named product. Get category ids from search_filters or from the category_path in product_details. ${THIRD_PARTY_NOTICE}`,
      inputSchema: searchInput,
    },
    wrap(runtime, 'browse_category', (args) => runSearch(runtime, args, 'browse_category')),
  );

  server.registerTool(
    'search_filters',
    {
      title: 'Available Torob filters',
      description:
        'Discover what can be filtered for a query or category: matching categories with their ids, brands with their ids, the observed price span in Toman, and the available sort orders. Call this first whenever you need a category_id or brand_id to narrow a search_torob or browse_category call.',
      inputSchema: searchFiltersInput,
    },
    wrap(runtime, 'search_filters', (args) => runSearchFilters(runtime, args)),
  );

  server.registerTool(
    'compare_products',
    {
      title: 'Compare Torob products',
      description: `Compare two to five products side by side: prices, seller counts, and only the specifications that actually differ between them. Use when the user is choosing between named options. Get the ids from search_torob, similar_products, or product_variants. Each product costs one request to Torob, so compare the shortlist, not everything. ${THIRD_PARTY_NOTICE}`,
      inputSchema: compareProductsInput,
    },
    wrap(runtime, 'compare_products', (args: { product_ids: string[] }) =>
      runCompareProducts(runtime, args.product_ids),
    ),
  );

  server.registerTool(
    'find_best_value',
    {
      title: 'Find best value on Torob',
      description: `Given a query and a budget in Toman, return the best-value matches ranked by how much headroom they leave against the budget and how many shops carry them. Use for "what is the best X under Y Toman" questions. The value_score is computed by this server, not by Torob - always confirm a specific pick with product_sellers before recommending it. ${THIRD_PARTY_NOTICE}`,
      inputSchema: findBestValueInput,
    },
    wrap(runtime, 'find_best_value', (args) => runFindBestValue(runtime, args)),
  );

  server.registerTool(
    'get_products_batch',
    {
      title: 'Get several Torob products',
      description: `Fetch compact cards for up to ten product ids at once - title, cheapest price, seller count, condition. Use to re-check a shortlist the user collected earlier, or to price several ids without a full product_details call each. Ids Torob does not recognise come back in not_found rather than failing the whole call. ${THIRD_PARTY_NOTICE}`,
      inputSchema: getProductsBatchInput,
    },
    wrap(runtime, 'get_products_batch', (args: { product_ids: string[] }) =>
      runGetProductsBatch(runtime, args.product_ids),
    ),
  );

  server.registerTool(
    'product_url',
    {
      title: 'Shareable Torob product link',
      description:
        'Turn a product id into a shareable torob.com link. Use whenever you mention a specific product so the user can open it themselves and confirm the live price. Costs no request to Torob unless include_title is set.',
      inputSchema: productUrlInput,
    },
    wrap(runtime, 'product_url', (args: { product_id: string; include_title: boolean }) =>
      runProductUrl(runtime, args.product_id, args.include_title),
    ),
  );
}
