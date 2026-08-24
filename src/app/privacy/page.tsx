import type { Metadata } from 'next';

/**
 * Public privacy policy. Required by Meta App Review (App Settings →
 * Basic → Privacy Policy URL) before Advanced Access can be granted
 * for whatsapp_business_messaging / whatsapp_business_management.
 * The "Deleting your data" section doubles as the Data Deletion
 * Instructions URL Meta also asks for — point both fields here.
 */

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = 'August 24, 2026';
const CONTACT_EMAIL = 'bitlanceai@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Bitlance WhatsApp CRM · Effective {EFFECTIVE_DATE}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-6">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Who we are</h2>
          <p>
            Bitlance WhatsApp CRM (&quot;the Service&quot;) is a customer
            relationship management platform operated by Bitlance Tech Hub
            that lets businesses connect their WhatsApp Business Account and
            manage customer conversations, contacts, message templates,
            broadcasts, and automations. Questions about this policy or your
            data: <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Data we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account data</strong> — your name, email address, and
              password (stored hashed) when you register.
            </li>
            <li>
              <strong>WhatsApp Business connection data</strong> — your
              WhatsApp Business Account ID, phone number ID, and access
              tokens obtained when you connect your account (directly or via
              Meta&apos;s Embedded Signup). Access tokens are stored
              encrypted (AES-256-GCM) and are never exposed to the browser.
            </li>
            <li>
              <strong>Messaging data</strong> — messages you send and
              receive through the WhatsApp Business Platform, delivery and
              read statuses, contact names and phone numbers, and media
              exchanged in conversations.
            </li>
            <li>
              <strong>Content you create</strong> — message templates,
              broadcasts, tags, notes, pipelines, and automation rules.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">How we use data</h2>
          <p>
            We use this data solely to provide the Service to you: routing
            and displaying your WhatsApp conversations, sending messages and
            broadcasts you initiate, syncing and creating message templates,
            tracking delivery analytics, and running automations you
            configure. Data obtained from Meta&apos;s platform is used in
            accordance with the{' '}
            <a
              className="text-primary underline"
              href="https://developers.facebook.com/terms/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meta Platform Terms
            </a>{' '}
            and the WhatsApp Business Terms of Service, only to provide and
            improve the Service, and never for advertising, profiling
            unrelated to the Service, or sale to third parties.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Sharing</h2>
          <p>
            We do not sell your data. Data is shared only with the
            infrastructure providers required to run the Service (database
            and authentication hosting, application hosting) under their own
            data-processing agreements, and with Meta Platforms, Inc. as
            required to deliver messages through the WhatsApp Business
            Platform. We disclose data if required by law.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Security &amp; retention</h2>
          <p>
            Access tokens are encrypted at rest; webhook traffic is verified
            with signed HMAC signatures; all traffic is served over HTTPS.
            Each account&apos;s data is isolated with row-level security.
            We retain your data for as long as your account is active.
          </p>
        </section>

        <section id="data-deletion">
          <h2 className="mb-2 text-lg font-semibold">Deleting your data</h2>
          <p className="mb-2">
            You can delete your data at any time:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Delete individual contacts, conversations, templates, or
              broadcasts from within the app — deletion is immediate.
            </li>
            <li>
              Disconnect your WhatsApp Business Account in Settings →
              WhatsApp Config to remove stored credentials.
            </li>
            <li>
              To delete your entire account and all associated data, email{' '}
              <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
              from your registered address with the subject &quot;Delete my
              account&quot;. We complete deletion within 30 days and confirm
              by email.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Changes</h2>
          <p>
            We may update this policy; material changes are announced in the
            app. The effective date above always reflects the latest
            revision.
          </p>
        </section>
      </div>
    </main>
  );
}
