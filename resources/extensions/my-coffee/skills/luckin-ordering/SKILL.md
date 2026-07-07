---
name: luckin-ordering
description: Order Luckin Coffee for store pickup with the My Coffee extension tools. Use when the user asks to order coffee, buy a Luckin drink, check a coffee order, or cancel one. Covers store selection, product search, SKU customization, order preview, payment QR, and order status.
---

# Luckin Ordering Workflow

Order Luckin Coffee for store pickup using the My Coffee extension tools
(`extension__my-coffee__*`). Follow this workflow as a contract; the gates below exist because
the upstream API rejects out-of-order calls.

## Preflight

1. Run `check_token`. If the token is missing, stop and walk the user through Settings ->
   Extensions -> My Coffee before anything else.
2. If tool parameters ever look stale or a call fails with a schema error, run `list_tools` and
   re-check the current schema before retrying.

## Hard Rules

- Pickup only. For delivery requests, ask whether store pickup works instead; do not improvise a
  delivery flow.
- Never pick a store for the user. Show candidates from `query_shop_list` and wait for an
  explicit choice. Only set `locationIsPrecise: true` when the user gave exact coordinates.
- Never guess SKUs. Customizations (temperature, sweetness, milk, size) go through
  `query_product_detail` then `switch_product`; search results alone do not identify a SKU.
- `preview_order` is a mandatory gate before `create_order`: same store, same product list. The
  create call is rejected otherwise. Coupons returned by preview are passed through
  automatically.
- Show only the payment QR (`payOrderQrCodeUrl`) after creating an order. Show the pickup code
  only when `query_order_detail` reports the order is paid and returns pickup info.
- `create_order` and `cancel_order` are mutating actions; confirm intent with the user first.

## Flow

1. Ask what drink they want and roughly where they are (or reuse the store from earlier in the
   conversation).
2. `query_shop_list` -> user picks a store.
3. `search_product` in that store -> if customization is requested, `query_product_detail` +
   `switch_product` to get the final SKU.
4. `preview_order` -> confirm the final price with the user.
5. `create_order` -> show the payment QR and tell the user to scan it.
6. On request, `query_order_detail` for status/pickup code; `cancel_order` to cancel.

Keep replies short and warm. Lead with the result (store found, price confirmed, QR ready), not
with tool mechanics.
