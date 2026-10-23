# Setting up the outside services

The app needs five outside services. Three are already set up; two need you.

| Service | What it is for | Status |
|---|---|---|
| GitHub | the code | done (`saisiddharthnandhakumar/demand-planning-assistant`) |
| Neon | the Postgres database | done (project `demand-planning-assistant`, Singapore) |
| Google Gemini | turns event notes into tags, writes edge briefs | done (`gemini-3.8-flash`) |
| **Zoho Inventory** | where the draft purchase orders are created | **you need to set this up** (part 1) |
| **Vercel** | hosts the app and runs the Monday/Thursday schedule | **you need to set this up** (part 2) |

Nothing else is needed: no email service, no payment service, no extra database.

Safe by default: until you switch it on, the app runs Zoho in **dry-run** mode. It prepares purchase orders and shows exactly what it *would* send, and sends nothing. You can use the whole app that way.

---

## Part 1: Zoho Inventory

### 1. Create the account, and note your data centre
1. Sign up at zoho.com/inventory. When asked for your country, pick the real one. This chooses your **data centre**, which decides every Zoho web address you will use:

   | Your Zoho address ends in | `ZOHO_DC` value |
   |---|---|
   | `zoho.com` | `com` |
   | `zoho.in` | `in` |
   | `zoho.eu` | `eu` |
   | `zoho.com.au` | `com.au` |
   | `zoho.jp` | `jp` |

   (`ca`, `sa` and `uk` also exist.) After you sign in, look at the address bar: that is your data centre. An Indian account normally ends in `.in`.
2. Check your plan includes API access (the free trial normally does; paid plans differ, so check Zoho's pricing page).
3. **Strongly recommended: do the first tests in a separate test organisation**, not your real one (Zoho Inventory lets one login hold more than one organisation; check that your plan allows it). Draft orders are harmless, but a test organisation lets you try things freely.

### 2. Find your Organisation ID
In Zoho Inventory open the gear icon (Settings), then **Organization Profile**. The page shows an **Organization ID** (a long number). This is `ZOHO_ORG_ID`. If you can't find it, tell me and we can read it through the API.

### 3. Create vendors and items in Zoho
The app places one order per **vendor** (the supplier you buy from). It needs real vendors and items to exist in Zoho.
1. **Vendors**: Purchases, then Vendors, then New. Create one vendor for each supplier. The sample data groups the 15 products under five suppliers: Beverage, Snack, Staples, Dairy Alt and Condiments. Use your real supplier names.
2. **Items**: Items, then New Item. Create one item per product, type **Goods**, with purchasing information enabled. **Important: in the item's SKU field, type our SKU code exactly (`SKU001`, `SKU002`, ... `SKU015`).** The lookup tool in step 7 matches items to our SKUs by this code, so this saves you copying 15 ids by hand.
3. The app deliberately sends **no prices**. Procurement adds prices in Zoho before sending. If Zoho refuses an order because a price is missing, see "If Zoho wants a price" below.

### 4. Create the API credentials (a "Self Client")
1. Open the Zoho **API Console** for your data centre: `api-console.zoho.com`, `api-console.zoho.in`, `api-console.zoho.eu`, and so on. Sign in with the same Zoho account.
2. Click **Get Started**, then choose **Self Client**, then **Create Now**, then **Create**, then **OK**.
3. Open the **Client Secret** tab. Copy the **Client ID** and **Client Secret**.

### 5. Generate the one-time grant code
1. Still in the Self Client, open the **Generate Code** tab.
2. **Scope**: paste exactly (no spaces):
   `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.contacts.READ,ZohoInventory.items.READ`
   The first two let the app create and read purchase orders. The last two are read-only and are used only by the lookup helper.
3. **Time duration**: the longest offered (about 10 minutes). **Scope description**: "Demand planning assistant".
4. Click **Create**. If it asks which Zoho service and organisation to use, choose **Zoho Inventory** and your organisation.
5. Copy the code immediately. **It works once and expires in minutes.**

### 6. Turn the code into a permanent refresh token
Put these in `.env.local` first (the app reads them; the file is never committed):
```
ZOHO_DC=in                      # your value from step 1
ZOHO_CLIENT_ID=...              # from step 4
ZOHO_CLIENT_SECRET=...          # from step 4
ZOHO_ORG_ID=...                 # from step 2
ZOHO_MODE=dry-run               # leave as dry-run for now
```
Then run, with the code from step 5:
```bash
npm run zoho:token -- <the grant code>
```
It prints one line, `ZOHO_REFRESH_TOKEN=...`. Paste that line into `.env.local`. The refresh token does not expire, so keep it secret. If it ever leaks, revoke it in the API Console and repeat steps 5 and 6. If you see "invalid code", the code was used or expired: generate a new one.

### 7. Look up your vendor and item ids
```bash
npm run zoho:lookup
```
This is read-only. It lists your Zoho vendors with their ids and matches each of our SKUs to a Zoho item by SKU code, flagging any that are missing or ambiguous.

### 8. Put the real ids into the vendor map
Edit `seed/sku_vendor_map.csv`. Its columns are:
`SKU_ID, Vendor_Name, Zoho_Vendor_ID, Zoho_Item_ID`
Replace every `PLACEHOLDER_...` with the real ids from step 7. (Note: the vendor here is the **supplier you buy from**, not the distributor in the SKU file, who is the customer.) Then apply it:
```bash
npm run vendor-map:update
```
This checks the file first (every SKU present once, no blanks), then replaces only the map. It never touches runs or decisions. Re-running `npm run seed` is *not* the way: it refuses once runs exist.

### 9. First live test (in the test organisation)
1. In `.env.local` change `ZOHO_MODE=dry-run` to `ZOHO_MODE=live`. (Only the exact word `live` turns it on.)
2. Restart the app, run a run, approve, and submit. The run page now shows "Draft created in Zoho" with a link for each vendor.
3. Open the order in Zoho and check: it is a **Draft**, the vendor and items are right, the reference number is the run id.
4. Try pressing the create button again: it must not make a second order.
5. If anything is odd, set the mode back to `dry-run`. Nothing is ever issued or sent by this app.

### If Zoho refuses an order
The app shows Zoho's own message on the order and lets you retry just that vendor. Two things I could not confirm from Zoho's published docs, so the first live test settles them:
- **Purchase order number.** Zoho's reference marks `purchaseorder_number` required. The app does not send one (it lets Zoho auto-number). If Zoho says a number is required, tell me and I will add one.
- **Prices.** If Zoho says a price (`purchase_rate`) is required on each line, set `ZOHO_FALLBACK_PURCHASE_RATE` in `.env.local` to a number you choose; the app then sends that on every line. It never invents a price.

### If an order shows "Waiting: unclear answer from Zoho"
Zoho did not answer clearly (a timeout, say), so the order might or might not exist. The app will not retry on its own, because that could create a duplicate. Search Zoho for a purchase order whose reference is the run id. If there is none, use "I checked Zoho: there is no order" on the run page and then retry. If there is one, leave it.

---

## Part 2: Vercel (needed for the live site and the schedule, milestone M9)

1. Create a free account at vercel.com (signing up with your GitHub login is easiest).
2. The Vercel command-line tool is already installed on this machine. In a terminal run `vercel login` and follow the prompt (it opens a browser). That is the only thing needed from you; I run the deploy.
3. I will link the project and add the environment variables from `.env.local` to Vercel (`DATABASE_URL`, `CRON_SECRET`, `APP_PASSWORD`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and the Zoho ones). Before that, decide:
   - **`APP_PASSWORD`**: the shared password for the live site. Pick a new, strong one for production rather than reusing the local test one.
   - **`ZOHO_MODE`**: leave `dry-run` for the first deploy.
4. The schedule (Monday and Thursday, 09:00 India time) is already in `vercel.json`. The free Hobby plan limits how often cron jobs can run; twice a week should be fine, and I will confirm with `vercel crons ls` after deploying.
5. The database stays on Neon: the same `DATABASE_URL` is used by the live site, so the vendor map and rules you set up locally are the live ones.

---

## Keeping secrets safe
- `.env.local` is never committed. Do not paste its contents into chat, email or screenshots.
- If a key or token is exposed, rotate it: Gemini in Google AI Studio, Zoho in the API Console, the database password in Neon, `APP_PASSWORD` and `CRON_SECRET` by editing `.env.local` and the Vercel settings.
