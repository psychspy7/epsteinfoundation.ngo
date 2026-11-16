# EPSTEIN FOUNDATION — "For Children." (Full-Stack Website & Donation Setup)

This package contains the complete frontend and Node.js/Express + SQLite backend for **EPSTEIN FOUNDATION — "For Children."**, including a dedicated **Donation Page** with Razorpay order creation and HMAC-SHA256 verification.

## Project Structure

- `server.js` — Express backend with SQLite persistence (`epstein_foundation.db`), inquiry endpoint (`/api/inquiries`), donation order/verification (`/api/donations/create-order`, `/api/donations/verify`), and transparent aggregate ledger (`/api/donations/ledger`).
- `public/index.html` — Responsive frontend featuring the main website, interactive **Donate / Support** page, 7-stage roadmap, and logo assets.
- `public/assets/` — Documentary photography and both foundation logo options.
- `.env.example` — Environment template (keep `DONATIONS_ENABLED=false` until Section 8 registration & bank/Razorpay KYC are completed).

## Quick Start (Local or VPS/Render/Railway)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Visit `http://localhost:3000` (and `http://localhost:3000/#donate` for the donation page).

## Enabling Live Donations (Post-Registration Only)

Keep `DONATIONS_ENABLED=false` while the Foundation is in the **proposal and Section 8 incorporation-planning stage**. Once Section 8 registration, nonprofit bank account, and Razorpay KYC are completed:
1. Add your `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
2. Set `FOUNDATION_STATUS=OPERATIONAL` and `DONATIONS_ENABLED=true`.
3. Restart the Node.js server.

## Redirecting From `epsteinfoundation.ngo.ind.in`

Because `ngo.ind.in` is a managed subdomain builder, you can link visitors from your `ngo.ind.in` page to your hosted full-stack site (for example on Render, Railway, or a custom domain) by adding a prominent **"Visit Official Portal / Support"** button in the `ngo.ind.in` customizer pointing to your deployed URL, or by using your own `.org` / `.org.in` domain once registered.
