# Vobia ERP — UI/UX Brief (for a design-focused AI: v0 / Lovable / Bolt / etc.)

Paste this whole file into the UI AI. Goal: get **presentational UI** we can drop into an existing Next.js app. Do NOT build auth, data fetching, routing, or a backend — those already exist.

## 1. Product in one line

Vobia ERP — an internal operations tool for a **fashion/apparel commerce** business (Indonesian market, IDR currency). Users are ops/PPIC/finance staff managing products, stock, production at vendors, sales orders across channels, and returns. Data-dense, keyboard-friendly, fast. Not a consumer app.

## 2. Hard tech constraints (output must fit these)

- **Next.js 16 App Router**, **TypeScript**, **Tailwind CSS v4**.
- Pages are **React Server Components** by default; interactive pieces (forms, toggles, buttons that mutate) are small **`'use client'`** components that receive data via props and call a passed-in handler.
- **Output we want:** presentational `.tsx` components using Tailwind classes, **props-driven**, no data fetching inside them. A component receives already-loaded data as props and renders it. For forms, use local `useState` and call an `onSubmit(values)` prop — do NOT call any API/supabase inside.
  - Acceptable alternative: self-contained **HTML + CSS** mockups per screen (we'll port to TSX).
- **Do NOT include:** login/auth, Supabase, `fetch`/server actions, routing config, database code, env vars. Assume all data arrives as typed props.
- No new heavy dependencies. Icons: inline SVG or a lightweight set. Charts: only if trivial (SVG); otherwise skip.

## 3. Design direction

Current theme is a **dark, utilitarian** look (feel free to elevate it, keep it dark + professional, high data density, generous tap targets). Current tokens (CSS variables) — reuse or improve, but keep a coherent token set:

```
--vb-bg:      #0f1b15   (app background, near-black green)
--vb-surface: #16211b   (cards, inputs)
--vb-border:  #2b3a31   (hairlines)
--vb-text:    #e8f0e8   (primary text)
--vb-muted:   #8fa89a   (secondary text)
--vb-accent:  #d7ff61   (lime accent — primary buttons, links, active state)
danger/negative: #ff9b9b
```

Layout shell: left **sidebar nav** (~200px) + main content. Nav items: Dashboard, Styles, Stock, Production, Vendors, Costing, Orders, Channels, Returns. Content pages = a page title + primary action button (top-right) + card(s) with tables/forms.

Deliver a small **component kit** first (button, input, select, card, table, badge/chip, metric card, empty state, page header) then the screens using them.

## 4. Screens + the data each renders

Money is IDR (format `1.234.567` or `Rp 1.234.567`). Every list needs an empty state.

### 4.1 Dashboard (home)
Metric cards row: **Styles** (count), **SKUs** (count), **Stock units** (sum of balances), **Open production** (count), **Orders** (count). Below: **Oversold alert** list — SKUs with negative balance `{ sku_code, balance }` (red). And **Recent orders** — last 5 `{ code, channel_name, order_date, total }`.

### 4.2 Styles
- **List:** rows `{ code, name, collection, colorway_count, sku_count }`, code links to detail. Header action "New style".
- **Create (form, interactive):** fields `code`, `name`, `collection`; a repeatable **colorways** list `{ color_name, color_code }` (add/remove); **sizes** as toggle chips (S/M/L/XL); a **live SKU preview grid** = each colorway × selected size → an editable code field (default `{code}-{color_code}-{size}`). Submit posts `{ code, name, collection, colorways[], sizes[], overrides{} }`.
- **Detail:** style header; table of SKUs `{ sku_code, colorway_name, size, active }` with an active on/off toggle per row.

### 4.3 Stock
Balances table `{ sku_code, balance }` (balance red if < 0). An **Adjustment form** (interactive): `sku` select, `qty` (signed integer), `reason` text → submit `{ sku_id, qty, reason }`. Recent movements table `{ sku_code, movement_type, qty, reason }` — movement_type ∈ production_in | sale_out | return_in | adjustment.

### 4.4 Production
- **List:** `{ code, style_code, vendor_name, stage, deadline }`. `stage` is a badge ∈ trial | mass_production | qc | completed | canceled.
- **Create:** select `style`, select `vendor`, `deadline` (date), `notes`; repeatable lines `{ sku, qty_ordered }`.
- **Detail:** header; a **stage stepper/buttons** showing current stage + only the legal next stages as buttons (trial→mass_production/canceled; mass_production→qc/canceled; qc→completed/mass_production/canceled; completed & canceled are terminal); a **prod-lines table** `{ sku_code, qty_ordered, qty_received (editable), reject_count (editable) }` with a Save per row; a **Costs** section: table `{ cost_type, amount, note }` + total + add-cost form `{ cost_type (material/cmt/overhead/other), amount, note }`.

### 4.5 Vendors
List `{ name, contact, active }` + create form `{ name, contact }`.

### 4.6 Costing
HPP table `{ sku_code, hpp, costed_units }` (hpp is money; may be null → "—").

### 4.7 Orders
- **List:** `{ code, channel_name, order_date, total }`.
- **Create:** select `channel`, `order_date`, `customer`, `notes`; repeatable lines `{ sku, qty, unit_price }`.
- **Detail:** header `{ code, channel_name, order_date, customer }`; lines table `{ sku_code, qty, unit_price, subtotal }` + total row.

### 4.8 Channels
List `{ name, active }` + create form `{ name }`.

### 4.9 Returns
- **List:** `{ code, order_code, return_date, reason }`.
- **Create:** select `order`, `return_date`, `reason`, `notes`; repeatable lines `{ sku, qty }`.
- **Detail:** header `{ code, order_code, return_date, reason }`; lines table `{ sku_code, qty }`.

### 4.10 Auth (low priority — we have functional versions)
Login `{ email, password }`, Signup `{ workspace_name, full_name, email, password }`, and an anonymous landing (product name + Log in / Sign up). Style these if you want; keep the field `name` attributes if you touch them.

## 5. What to hand back to the developer

- Prefer: a set of **presentational `.tsx` components** (props-driven, Tailwind) organized by screen, plus the shared component kit and the token/theme CSS. A short note on each component's props.
- Or: **HTML + CSS** per screen + the component kit.
- Keep interactive state local (`useState`) and surface actions as `on*` props. No API calls, no routing, no auth.

## 6. Priorities

1. Component kit + app shell (sidebar + page header).
2. Dashboard, Styles (list/create/detail), Stock — the highest-traffic screens.
3. The rest of the list/create/detail screens (Production, Orders, Returns, Vendors, Channels, Costing).
