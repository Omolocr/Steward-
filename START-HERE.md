# Church Connect – start here (plain language)

**What you have:** a church app for Android and iPhone, plus a small server that keeps the records safely. Nothing can be deleted – records are only archived, and every change is logged.

## Try it first (5 minutes, no setup)
Open `church-app-preview.html` in any browser. Use the "Preview as" box to switch between Treasurer, Secretary, Pastor, a member, and so on. Use the 📱 SMS and "M-Pesa sim" buttons to see login codes, receipts and payment checking.

## Running the app for many churches (you are the app developer)
Read `DEVELOPER-GUIDE.md`. In short: list up to 10 developer phones in `DEVELOPERS=`, open `/console`, create each church, and give each church its **special church number**. In the preview, use "Preview as" → *App developer console* (phone 0700000001; the code is in the 📱 SMS box). Church numbers to try: shown on the sign-in page.

## Going live – in this order
1. **Pay Bill number:** put your church's real Pay Bill and account format in `src/data/constants.ts`.
2. **Server:** follow `deploy/DEPLOY.md` (a small rented server, about 15 steps). Then run `deploy/GO-LIVE-CHECKLIST.md`; it tells you what to test and what "good" looks like.
3. **SMS:** create an Africa's Talking account (login codes and receipts are sent by SMS). Start in their sandbox, then switch to live with a small balance.
4. **First leaders:** one church only: set `DEFAULT_CHURCH` and `BOOTSTRAP` in `.env` with the Secretary's and Pastor's phone numbers (they are trusted automatically). Many churches: the Church Admin you appoint approves each church's Secretary and Pastor in the app.
5. **M-Pesa checking (optional):** ask Safaricom for Daraja access on your Pay Bill, then use `server/mpesa-register.mjs`. Without it the Treasurer simply confirms payments by hand.
6. **Sermon summaries (optional):** add the AI keys in `.env`.
7. **Phones:** run the app in Expo Go to test, then build with EAS (`eas.json`) for the Play Store / App Store.

## Honest status
The server is tested against stand-in services. The mobile app has been type-checked but not yet run on a real phone, and the real Safaricom, SMS and AI services have not been tested. Expect a short round of fixes when you first run it – do that with a few leaders before opening it to the whole church.
