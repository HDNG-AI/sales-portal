# Odelco CMS forms — staged Scaleway intake (2026-10-12)

## Scope
Replace the `mailto:` submission of Odelco Contact and Support forms with a same-origin
Nitro receiver, without placing secrets or email destinations in Geins CMS data.

This is a staging-only opt-in. **No CMS form will change behavior until `formEndpoint`
is set** and the server env is deployed. No production delivery is implied by a green CI.

### CMS configuration (Geins Studio)
In the JSON widget for the Odelco contact page add:
```json
{
  "formEndpoint": "contact",
  "sendFormToEmail": "info@odelco.se",
  "fields": [
    { "name": "company", "label": "Företag", "type": "input", "required": false },
    { "name": "email", "label": "E-postadress", "type": "email", "required": true },
    { "name": "message", "label": "Meddelande", "type": "textarea", "required": true }
  ]
}
```
Preserve the real widget's other fields, options and consent handling. The three
fields above are a minimal example, **not** a replacement for live page JSON.
`formEndpoint: "support"` is the support equivalent.
`sendFormToEmail` stays visible as an optional fallback link; it is *not*
a server-configurable recipient. Remove/adjust the fallback only by explicit
merchant decision after real email delivery has been checked.

**Do not enable `formEndpoint: "newCustomer"` yet.** That mode intentionally
returns HTTP 503 until a verified Odelco Twenty CRM intake API, field mapping,
deduplication, and explicit permission are established. Do not silently fall back
to sending an application to an unmonitored mailbox or claiming a CRM lead exists.

## Server settings on the Sales Portal Odelco staging service
All values are server-only runtime secrets/config:

| Variable | Purpose |
| --- | --- |
| `ODELCO_FORMS_ALLOWED_HOSTS` | comma-separated server-validated Odelco hostnames, initially `staging-odelco.hdng.ai` |
| `SCALEWAY_STOREFRONT_SECRET_KEY` | **new app-specific Scaleway IAM application key**, scoped to `HDNG Core` and email API create only |
| `SCALEWAY_STOREFRONT_PROJECT_ID` | public Scaleway project UUID for `HDNG Core`, not an API secret |

**Never copy `odelco-adminpage`'s `SCALEWAY_SECRET_KEY`** into Sales Portal;
issue a separate key to avoid cross-application credential sharing.
The sender is `noreply@hdng.ai` and must be verified in Scaleway TEM.
The receiving addresses are server-owned allowlisted constants:
Contact `hello@hdng.ai`; Support `support@odelco.se`.
The customer email goes in Reply-To if it parses as an email address, not in
To, From, or a customer-controlled destination.

The service refuses non-allowlisted hosts, unknown tenants, different-origin
POSTs, missing customer email and malformed payloads. It rate-limits by IP and
uses honeypot + minimum render-to-submit time. **Anti-abuse rejection never
returns a success receipt:** this avoids silently losing a valid customer lead
if browser autofill or quick submission triggers a heuristic. Only a validated
Scaleway CreateEmailResponse containing an accepted email ID produces a 200;
provider acceptance is not proof that the recipient inbox received the email. Note: the existing shared
`getClientIp` trusts forwarded-for headers — verify that the HDNG reverse
proxy overwrites them before relying on rate limits; add provider-edge abuse
protection before any public high-volume launch. No submitted contents are
logged. The endpoint reports success only after Scaleway accepts the message;
that is **not** proof of recipient mailbox delivery.

## End-to-end acceptance / rollout
1. Add the independent key and config on *staging only*; restrict allowlist to actual tenant hostname.
2. Exercise invalid tenant/Origin, invalid email, repeated requests, honeypots,
   quick-submit, provider failure and valid contact tests; ensure no mail on failed cases.
3. Enable `formEndpoint: "contact"` in a single CMS test widget; send approved
   non-sensitive test request. Verify Scaleway acceptance and *actual receipt*
   at `hello@hdng.ai`, expected subject and Reply-To.
4. Repeat for Support; avoid routing real support to a mailbox that nobody watches.
5. Verify browser and mobile UX, translation, required checkbox fields and
   network failures. Review GDPR retention and incident handling for customer messages.
6. Only then roll out to Odelco production with separate explicit permission,
   staging approval and updated allowlisted production hostname.
7. Keep newsletter subscribeToNewsletter unchanged; test it separately.
8. Integrate `newCustomer` directly with Twenty only after defining target
   company/person objects, required fields, deduplication, pipeline, consent,
   API principal and retry/idempotency strategy.

Related: `HDNG-AI/odelco-storefront#4`, `#28`; historical
`feat/cms-embedded-form` provided UI pattern but assumed a different
`/api/external/*` receiver. This PR adds the actual same-origin receiver.
