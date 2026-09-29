# Zhijiabao · Scenic Souvenir Circular Marketplace

English summary. The Chinese [README.md](README.md) is the authoritative document (it carries the full
architecture, database, data-source and compliance notes required by the competition submission).

## What it is

A platform for reselling scenic-area cultural merchandise ("文创"). A traveller can upload a photo, get an
**explainable AI valuation**, compare official / second-hand / suggested prices, publish the item to the
marketplace, and complete the deal through **platform escrow** with after-sales support.
Coverage: 8 scenic areas, 10 product categories.

- Static demo (falls back to a local-only mode): <https://chenhailin518518.github.io/zhijiabao-v2/>
- Stack: **MySQL 8 (InnoDB / utf8mb4)** + Node backend (native `http` + `mysql2`) + vanilla JavaScript front end

## Run locally

Requirements: Node.js ≥ 22 and MySQL 8.

```sql
CREATE DATABASE IF NOT EXISTS zhijiabao CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS zhijiabao_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'zhijiabao'@'%' IDENTIFIED BY 'zhijiabao@2026';
GRANT ALL PRIVILEGES ON zhijiabao.* TO 'zhijiabao'@'%';
GRANT ALL PRIVILEGES ON zhijiabao_test.* TO 'zhijiabao'@'%';
FLUSH PRIVILEGES;
```

```bash
cp .env.example .env    # fill in MYSQL_USER / MYSQL_PASSWORD
npm install
npm run db:init         # create tables + initial demo data (idempotent)
npm start               # http://localhost:8080
npm test                # unit + static + API integration + jsdom page tests (needs MySQL)
```

Demo accounts: admin `18800000000 / admin888`, users `18800000001 / demo1234`, `18800000002 / demo1234`.
Run `npm run seed:demo` to generate a richer dataset (orders in every state, analytics events, after-sales, reports).

If `/api/health` is unreachable (e.g. GitHub Pages), the front end degrades to `localStorage` and shows a
"local demo mode" badge in the footer — every feature keeps working with the same semantics.

## Highlights

- **Explainable valuation**: suggested price = original price × condition × scenic-area retention × season ×
  certificate/packaging bonus × keyword adjustment × supply-demand (popularity × live weather). All seven
  factors are shown to the user; the model is a rule-based model, not a trained ML model, and says so.
- **Escrow order state machine**: pending payment → pending shipment → pending receipt → completed, with
  logistics, release-on-receipt (2% platform fee), cancellation, after-sales refund and two-way reviews.
  Every transition runs inside a MySQL transaction with `SELECT ... FOR UPDATE` row locking.
- **SQL-first backend**: `server/sql/schema.sql` (18 tables, InnoDB/utf8mb4) and `server/sql/seed.sql`, executed
  automatically on first start; parameterised queries throughout, rate limiting, sensitive-word filtering and
  audit logs.
- **Trust & compliance**: real-name verification stores a masked ID number only, a dedicated user-agreement /
  privacy page, third-party data sources labelled, simulated price series flagged as `simulated: true`.
- **Performance**: all images converted to WebP (6.8 MB → ~0.5 MB), Service Worker for offline/weak networks,
  `prefers-reduced-motion` support and a skip-to-content link.

## Tests

| Command | Coverage |
| --- | --- |
| `npm run test:unit` | valuation model, order state machine, credit score, price series, form validation |
| `npm run test:smoke` | asset references & version consistency, mirror pages in sync, SEO/a11y/compliance files, image size ceiling, MySQL usage |
| `npm run test:api` | end-to-end API flow on a dedicated test database: register → publish → review → order → pay → ship → confirm → review → refund (26 checks) |
| `npm run test:dom` | executes all 10 pages in jsdom and verifies rendering plus the local escrow flow |

## License

MIT © Zhijiabao team. This is a competition demo: payments are simulated and data is for demonstration only.
