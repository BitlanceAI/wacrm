import type { Metadata } from 'next';

/**
 * Public Terms of Service. Linked from Meta App Settings → Basic →
 * Terms of Service URL. Kept in the same voice and layout as the
 * privacy policy at /privacy.
 */

export const metadata: Metadata = {
  title: 'Terms of Service',
  robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = 'August 24, 2026';
const CONTACT_EMAIL = 'ceo@bitlancetechhub.com';

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Bitlance WhatsApp CRM · Effective {EFFECTIVE_DATE}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-6">
        <section>
          <h2 className="mb-2 text-lg font-semibold">1. The Service</h2>
          <p>
            Bitlance WhatsApp CRM (&quot;the Service&quot;), operated by
            Bitlance Tech Hub (&quot;we&quot;, &quot;us&quot;), is a customer
            relationship management platform that lets businesses connect
            their WhatsApp Business Account to manage customer
            conversations, contacts, message templates, broadcasts, and
            automations. By creating an account or using the Service you
            agree to these terms. If you use the Service on behalf of a
            business, you confirm you are authorized to bind that business.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">2. Your account</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>You must provide accurate registration information and keep your credentials confidential.</li>
            <li>You are responsible for all activity under your account.</li>
            <li>You must be legally capable of entering a contract to use the Service.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">3. WhatsApp &amp; Meta platform terms</h2>
          <p>
            The Service is built on the WhatsApp Business Platform operated
            by Meta Platforms, Inc. By connecting a WhatsApp Business
            Account you also agree to, and must comply with, the{' '}
            <a className="text-primary underline" href="https://business.whatsapp.com/policy" target="_blank" rel="noopener noreferrer">
              WhatsApp Business Messaging Policy
            </a>{' '}
            and the{' '}
            <a className="text-primary underline" href="https://developers.facebook.com/terms/" target="_blank" rel="noopener noreferrer">
              Meta Platform Terms
            </a>
            . Meta may independently restrict, suspend, or revoke your
            WhatsApp Business Account or phone number; we are not
            responsible for actions Meta takes on its platform.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">4. Acceptable use</h2>
          <p className="mb-2">You agree that you will NOT use the Service to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Message people without their consent, or send spam, bulk unsolicited messages, or messages that violate WhatsApp&apos;s opt-in requirements.</li>
            <li>Send unlawful, deceptive, harassing, or harmful content, or content that infringes others&apos; rights.</li>
            <li>Sell, purchase, or promote illegal or restricted goods and services.</li>
            <li>Attempt to probe, disrupt, or gain unauthorized access to the Service or other users&apos; data.</li>
            <li>Resell or sublicense the Service without our written agreement.</li>
          </ul>
          <p className="mt-2">
            We may suspend or terminate accounts that violate these rules or
            that put the Service&apos;s WhatsApp integration at risk.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">5. Your content and data</h2>
          <p>
            You retain ownership of the contacts, messages, templates, and
            other content you bring to or create in the Service. You grant
            us the limited rights needed to store, process, and transmit
            that content solely to operate the Service. You are responsible
            for having a lawful basis (including any required consent) to
            message your contacts and to store their information. Our
            handling of personal data is described in the{' '}
            <a className="text-primary underline" href="/privacy">Privacy Policy</a>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">6. Fees</h2>
          <p>
            Where the Service is offered under a paid plan, fees, billing
            periods, and included usage are stated at purchase. Meta charges
            for WhatsApp conversations separately under its own pricing; you
            are responsible for those charges on your Meta account.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">7. Availability &amp; changes</h2>
          <p>
            We aim for high availability but the Service is provided
            &quot;as is&quot; and &quot;as available&quot;, without
            warranties of any kind, whether express or implied. We may
            modify, suspend, or discontinue features with reasonable notice
            where practical. Delivery of WhatsApp messages ultimately
            depends on Meta&apos;s platform and the recipient&apos;s device,
            neither of which we control.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">8. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we are not liable for
            indirect, incidental, special, or consequential damages, or for
            loss of profits, revenue, data, or business, arising from use of
            the Service. Our total aggregate liability for any claim is
            limited to the amounts you paid us for the Service in the three
            months before the event giving rise to the claim.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">9. Termination</h2>
          <p>
            You may stop using the Service and request account deletion at
            any time (see the{' '}
            <a className="text-primary underline" href="/privacy#data-deletion">data deletion instructions</a>
            ). We may suspend or terminate accounts for breach of these
            terms. On termination, your data is deleted in accordance with
            the Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">10. Governing law</h2>
          <p>
            These terms are governed by the laws of India, and disputes are
            subject to the exclusive jurisdiction of the courts of India.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">11. Changes to these terms</h2>
          <p>
            We may update these terms; material changes are announced in the
            app or by email. Continued use after changes take effect
            constitutes acceptance. Questions:{' '}
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
