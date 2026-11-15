# Asset Rental - Email OTP Setup

This project supports customer email verification before a newly created account can sign in.

## How it works

1. A customer creates an account from the login/register page.
2. The app stores the user as `PENDING_VERIFICATION`.
3. The app sends a 6-digit OTP to the email the user entered.
4. The user enters that code on the same login page to verify the account.
5. Once verified, the account status becomes `ACTIVE` and the user can log in normally.

## Development setup

1. Copy the example environment file:

   ```bash
   copy .env.example .env
   ```

2. Update the email values in `.env`:

   ```env
   SMTP_HOST="smtp.mailtrap.io"
   SMTP_PORT="2525"
   SMTP_SECURE="false"
   SMTP_USER="your_mailtrap_user"
   SMTP_PASS="your_mailtrap_password"
   SMTP_FROM="Asset Rental <noreply@localhost>"
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Create a new customer account from the login page and use the email address you entered.

## Mailtrap / test email flow

For local testing, Mailtrap is the easiest option.

- Sign up at https://mailtrap.io
- Create an inbox
- Copy the SMTP host, port, username, and password into `.env`
- Then register a customer account and check the inbox for the verification code

## Fallback mode

If `SMTP_HOST` is not configured, the app will print the OTP to the terminal in development mode instead of sending an email. This is useful for quick testing without an actual SMTP provider.

Example terminal output:

```text
[OTP TEST MODE] Verification code for test@example.com: 123456
```

## Important notes

- New users are not active immediately after registration.
- They must verify the code before they can log in.
- The OTP expires after 5 minutes.
- The verification step is enforced by the backend routes in `src/app/api/auth/login/route.ts` and `src/app/api/auth/verify-otp/route.ts`.

## ABA PayWay sandbox KHQR

The rental checkout can create an ABA PayWay KHQR payment and verifies the transaction with PayWay before confirming the rental. Add these values to `.env` using the sandbox credentials from your PayWay sandbox account:

```env
PAYWAY_BASE_URL="https://checkout-sandbox.payway.com.kh"
PAYWAY_MERCHANT_ID="your_sandbox_merchant_id"
PAYWAY_API_KEY="your_sandbox_api_key"
PAYWAY_CALLBACK_URL="https://your-public-domain/api/payment-providers/payway/webhook"
```

Keep `PAYWAY_API_KEY` server-side; never expose it with a `NEXT_PUBLIC_` prefix. For local testing, PayWay cannot call a localhost callback URL, but the checkout also checks transaction status from the server. For deployment, configure a public HTTPS callback URL and whitelist its domain in the PayWay merchant profile. Use the production base URL and production credentials only after sandbox testing is complete.
