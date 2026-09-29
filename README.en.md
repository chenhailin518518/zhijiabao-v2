# Zhijiabao · Scenic Souvenir Circular Marketplace

English summary. The Chinese [README.md](README.md) is the authoritative document (it carries the full
architecture, data-source and compliance notes required by the competition submission).

## What it is

A prototype platform for reselling scenic-area cultural merchandise ("文创"). A traveller can upload a photo,
get an **explainable AI valuation**, compare official / second-hand / suggested prices, publish the item to the
marketplace, and complete the deal through **platform escrow** with after-sales support.
Coverage: 8 scenic areas, 10 product categories.

- Static demo (auto-falls back to a local-only mode): <https://chenhailin518518.github.io/zhijiabao-demo/>
- Stack: vanilla JavaScript front end + a **zero-dependency** Node backend (`node:http` + `node:sqlite`)

## Run locally

```bash
npm start        # Node >= 22, no runtime dependencies; serves the site and the REST API on :8080
npm test         # unit + static + API integration + jsdom page tests
```

Demo accounts: admin `18800000000 / admin888`, users `18800000001 / demo1234`, `18800000002 / demo1234`.

If `/api/health` is unreachable (e.g. GitHub Pages), the front end degrades to `localStorage` and shows a
"local demo mode" badge in the footer — every feature keeps working with the same semantics.

## Highlights

- **Explainable valuation**: suggested price = original price × condition × scenic-area retention × season ×
  certificate/packaging bonus × keyword adjustment × supply-demand (popularity × live weather). All seven
  factors are shown to the user; the model is a rule-based model, not a trained ML model, and says so.
- **Escrow order state machine**: pending payment → pending shipment → pending receipt → completed, with
  logistics, release-on-receipt, cancellation, after-sales refund and two-way reviews.
- **Real backend**: accounts, products, orders, reviews, reports, messages, addresses, analytics and an
  operations console all persist in SQLite, with rate limiting, sensitive-word filtering and audit logs.
- **Trust & compliance**: real-name verification stores a masked ID number only, a dedicated user-agreement /
  privacy page, third-party data sources labelled, and simulated price series flagged as `simulated: true`.
- **Performance**: all images converted to WebP (6.8 MB → ~0.5 MB), Service Worker for offline/weak networks,
  `prefers-reduced-motion` support and a skip-to-content link.

## Tests

| Command | Coverage |
| --- | --- |
| `npm run test:unit` | valuation model, order state machine, credit score, price series, form validation |
| `npm run test:smoke` | asset references & version consistency, mirror pages in sync, SEO/a11y/compliance files, image size ceiling |
| `npm run test:api` | end-to-end API flow: register → publish → review → order → pay → ship → confirm → review → refund |
| `npm run test:dom` | executes all 10 pages in jsdom and verifies rendering plus the local escrow flow |

## License

MIT © Zhijiabao team. This is a competition demo: payments are simulated and data is for demonstration only.
