import Link from "next/link";
import { Zap } from "lucide-react";

const LAST_UPDATED = "May 12, 2025";
const APP_NAME = "OutreachAI";
const CONTACT_EMAIL = "hamza.abtach90@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="space-y-2 text-sm text-gray-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* Navbar */}
      <nav className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            {APP_NAME}
          </Link>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">← Back to Home</Link>
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-16 space-y-10">

        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
          <p className="text-sm text-gray-400">Last updated: {LAST_UPDATED}</p>
          <p className="text-sm text-gray-600 leading-relaxed pt-1">
            This Privacy Policy explains how {APP_NAME} ("we", "us", or "our") collects, uses, and protects
            your information when you use our outreach automation service. By using {APP_NAME} you agree to
            the practices described here.
          </p>
        </div>

        <Section title="1. Information We Collect">
          <p><strong>Account information:</strong> When you sign up we collect your name and email address to create and identify your account.</p>
          <p><strong>Gmail OAuth tokens:</strong> When you connect your Gmail account we receive and store OAuth 2.0 access and refresh tokens issued by Google. We never receive or store your Gmail password.</p>
          <p><strong>Campaign data:</strong> Niches, blog sources, scraped contact emails, AI-generated outreach drafts, and send/open/reply records you create while using the service.</p>
          <p><strong>Usage data:</strong> Standard server logs (IP address, request timestamps, HTTP status codes) retained for debugging and security purposes.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul className="list-disc list-inside space-y-1.5">
            <li>Create and manage your account.</li>
            <li>Send outreach emails from your connected Gmail address on your behalf.</li>
            <li>Poll your Gmail threads to detect replies to sent outreach emails (reply tracking).</li>
            <li>Generate email open-tracking pixels tied to your sent emails.</li>
            <li>Send password reset emails when requested.</li>
            <li>Improve service reliability and debug issues using server logs.</li>
          </ul>
          <p>We do not use your data to train AI models, serve advertisements, or share it with third parties for marketing purposes.</p>
        </Section>

        <Section title="3. Gmail Data & Google API Policy">
          <p>
            {APP_NAME} uses the Gmail API with the following OAuth scopes:
          </p>
          <ul className="list-disc list-inside space-y-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <li>gmail.send — send emails on your behalf</li>
            <li>gmail.readonly — read thread data to detect replies</li>
            <li>gmail.modify — mark reply threads as read</li>
          </ul>
          <p>
            Our use of Gmail data is limited to the purposes above. We do not read, store, or process the
            content of emails in your inbox beyond what is necessary to detect replies to outreach emails
            sent by this tool.
          </p>
          <p>
            {APP_NAME}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section title="4. Data Storage & Security">
          <p>Your data is stored in a PostgreSQL database hosted on Neon (cloud-hosted, TLS-encrypted at rest and in transit).</p>
          <p>OAuth tokens are stored in the database and are only used to make Gmail API calls on your behalf. Access tokens expire after 1 hour and are refreshed automatically using the stored refresh token.</p>
          <p>We use industry-standard practices including HTTPS, hashed passwords (bcrypt), and short-lived JWT access tokens. No sensitive credentials are ever logged.</p>
        </Section>

        <Section title="5. Data Sharing">
          <p>We do not sell, rent, or trade your personal information. We share data only in the following limited cases:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li><strong>Google:</strong> OAuth token exchange and Gmail API calls as described in Section 3.</li>
            <li><strong>Google Gemini API:</strong> Blog content and lead context is sent to Gemini to generate personalized outreach email drafts. No personally identifiable user account data is included in these prompts.</li>
            <li><strong>Legal requirement:</strong> If required by law or to protect the rights and safety of users.</li>
          </ul>
        </Section>

        <Section title="6. Your Rights & Data Deletion">
          <p>You can delete your account at any time from <strong>Settings → Danger Zone → Delete Account</strong>. This permanently removes your account, campaigns, leads, sent logs, and all associated data from our database.</p>
          <p>To revoke Gmail access, go to your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
              Google Account permissions
            </a>{" "}
            and remove {APP_NAME}. You can also disconnect Gmail from the Settings page inside the app.
          </p>
          <p>To request a copy of your data or ask any privacy-related questions, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="7. Cookies & Tracking">
          <p>We use <code className="bg-gray-100 px-1 rounded text-xs">localStorage</code> to store your authentication tokens client-side. We do not use third-party analytics cookies or advertising trackers.</p>
          <p>The open-tracking pixel embedded in outreach emails is a 1×1 transparent image hosted on our backend. It records the timestamp and count of opens for emails you sent — it is not used for any other tracking purpose.</p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>{APP_NAME} is not intended for use by anyone under the age of 13. We do not knowingly collect personal information from children.</p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top. Continued use of the service after changes are posted constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions or concerns about this policy? Reach us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 text-center text-sm text-gray-400">
        <p>© {new Date().getFullYear()} {APP_NAME}. <Link href="/" className="hover:underline">Back to Home</Link></p>
      </footer>

    </div>
  );
}
