import Link from "next/link";
import { Zap } from "lucide-react";

const LAST_UPDATED = "June 12, 2026";
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

export default function TermsAndConditionsPage() {
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
          <h1 className="text-3xl font-bold text-gray-900">Terms and Conditions</h1>
          <p className="text-sm text-gray-400">Last updated: {LAST_UPDATED}</p>
          <p className="text-sm text-gray-600 leading-relaxed pt-1">
            These Terms and Conditions ("Terms") govern your use of {APP_NAME} ("we", "us", or "our") outreach automation service. By accessing or using {APP_NAME}, you agree to be bound by these Terms. If you do not agree to these Terms, please do not use the service.
          </p>
        </div>

        <Section title="1. Acceptance of Terms">
          <p>By creating an account, logging in, or otherwise using {APP_NAME}, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions, our Privacy Policy, and any other policies or guidelines we may publish from time to time.</p>
          <p>If you are entering into these Terms on behalf of a company or organization, you represent that you have the authority to bind such entity to these Terms.</p>
        </Section>

        <Section title="2. Description of Service">
          <p>{APP_NAME} is an automated blog outreach system that helps users:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Discover relevant blogs in their niche</li>
            <li>Scrape and validate contact information from blogs</li>
            <li>Generate personalized outreach emails using AI</li>
            <li>Send and track outreach campaigns</li>
            <li>Manage and monitor email outreach efforts</li>
          </ul>
          <p>The service includes both a frontend web application and a backend API that work together to provide these features.</p>
        </Section>

        <Section title="3. User Accounts">
          <p>To access certain features of {APP_NAME}, you must create an account. You agree to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Provide accurate, current, and complete information during registration</li>
            <li>Maintain the security of your password and account credentials</li>
            <li>Notify us immediately of any unauthorized use of your account</li>
            <li>Be responsible for all activities that occur under your account</li>
          </ul>
          <p>We reserve the right to suspend or terminate your account if we believe you have violated these Terms.</p>
        </Section>

        <Section title="4. User Responsibilities">
          <p>As a condition of your use of {APP_NAME}, you agree not to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Use the service for any unlawful purpose or in violation of any applicable laws</li>
            <li>Send spam, unsolicited bulk email, or engage in any activity that violates anti-spam laws (including CAN-SPAM, GDPR, CASL, etc.)</li>
            <li>Harvest or collect information about others without their consent</li>
            <li>Interfere with or disrupt the service or servers connected to the service</li>
            <li>Attempt to gain unauthorized access to {APP_NAME} systems or other users' accounts</li>
            <li>Use the service to transmit any harmful, abusive, racially offensive, defamatory, obscene, or unlawful material</li>
            <li>Reverse engineer, decompile, or disassemble any part of the service</li>
          </ul>
          <p>You are solely responsible for ensuring that your use of {APP_NAME} complies with all applicable laws and regulations, including email marketing and data protection laws.</p>
        </Section>

        <Section title="5. Intellectual Property">
          <p>All content, features, and functionality of {APP_NAME}, including but not limited to text, graphics, logos, images, software, and the arrangement thereof, are the proprietary property of {APP_NAME} and are protected by copyright, trademark, and other intellectual property laws.</p>
          <p>Subject to your compliance with these Terms, {APP_NAME} grants you a limited, non-exclusive, non-transferable, revocable license to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Access and use the service for your personal or business outreach activities</li>
            <li>Use AI-generated content provided by the service for your outreach campaigns</li>
          </ul>
          <p>This license does not include any right to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Resell or commercialize the service</li>
            <li>Modify or create derivative works based on the service</li>
            <li>Use data mining, robots, or similar data gathering methods on the service</li>
            <li>Download (other than page caching) or copy any portion of the service for commercial purposes</li>
          </ul>
        </Section>

        <Section title="6. Third-Party Services">
          <p>{APP_NAME} integrates with several third-party services to provide its functionality:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Google/Gmail:</strong> For sending emails via OAuth authentication</li>
            <li><strong>OpenAI:</strong> For generating personalized outreach email content</li>
            <li><strong>SerpAPI:</strong> For discovering blogs through search engine results</li>
            <li><strong>Neon:</strong> For PostgreSQL database hosting</li>
          </ul>
          <p>Your use of these third-party services is subject to their respective terms of service and privacy policies. We are not responsible for any issues arising from your use of or inability to use these third-party services.</p>
          <p>By using {APP_NAME}, you acknowledge that your data may be transferred to and processed by these third-party service providers in accordance with their policies.</p>
        </Section>

        <Section title="7. Payment and Fees">
          <p>Currently, {APP_NAME} is offered free of charge. However, we reserve the right to introduce fees for premium features or increased usage limits at any time.</p>
          <p>If we introduce paid features, we will provide clear notice of any charges before they take effect. Continued use of the service after such notice constitutes your agreement to pay the applicable fees.</p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, {APP_NAME} IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Warranties of merchantability or fitness for a particular purpose</li>
            <li>Warranties of title or non-infringement</li>
            <li>Warranties that the service will be uninterrupted, error-free, or secure</li>
            <li>Warranties regarding the accuracy, reliability, or quality of any information or content provided through the service</li>
          </ul>
          <p>We do not warrant that the service will meet your requirements or that any errors in the service will be corrected.</p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL {APP_NAME}, ITS OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Any indirect, incidental, special, consequential, or punitive damages</li>
            <li>Loss of profits, revenue, data, or use</li>
            <li>Cost of procurement of substitute goods or services</li>
            <li>Any other losses arising out of or related to your use of the service</li>
          </ul>
          <p>IN NO EVENT SHALL {APP_NAME}'S TOTAL LIABILITY TO YOU FOR ALL DAMAGES, LOSSES, OR CAUSES OF ACTION EXCEED THE AMOUNT YOU HAVE PAID TO {APP_NAME} IN THE SIX (6) MONTHS PRECEDING THE EVENT GIVING RISE TO THE LIABILITY.</p>
          <p>SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THE ABOVE LIMITATION MAY NOT APPLY TO YOU.</p>
        </Section>

        <Section title="10. Indemnification">
          <p>You agree to indemnify, defend, and hold harmless {APP_NAME} and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses, including reasonable attorney's fees, arising out of or in any way connected with:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Your access to or use of {APP_NAME}</li>
            <li>Your violation of any term of these Terms</li>
            <li>Your violation of any third-party right, including any intellectual property or privacy right</li>
            <li>Your violation of any applicable law, rule, or regulation</li>
          </ul>
        </Section>

        <Section title="11. Termination">
          <p>We may suspend or terminate your access to {APP_NAME}, without notice or liability, for any reason, including if you breach these Terms.</p>
          <p>Upon termination, your right to use the service will immediately cease. If we terminate your account for cause, you may not be permitted to re-register for the service.</p>
          <p>You may delete your account at any time through the account settings in the application.</p>
          <p>Sections that by their nature should survive termination will survive termination, including ownership provisions, warranty disclaimers, indemnification, and limitations of liability.</p>
        </Section>

        <Section title="12. Changes to Terms">
          <p>We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice before any new terms take effect. What constitutes a material change will be determined at our sole discretion.</p>
          <p>By continuing to access or use {APP_NAME} after any revisions become effective, you agree to be bound by the revised terms. If you do not agree to the new terms, please discontinue using the service.</p>
        </Section>

        <Section title="13. Governing Law">
          <p>These Terms shall be governed by and construed in accordance with the laws of [Your State/Country], without regard to its conflict of law principles.</p>
          <p>You agree to submit to the personal and exclusive jurisdiction of the courts located within [Your State/Country] to resolve any dispute arising from these Terms.</p>
        </Section>

        <Section title="14. Contact Information">
          <p>If you have any questions about these Terms, please contact us at:</p>
          <p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>
          </p>
        </Section>

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 text-center text-sm text-gray-400">
        <p>
          © {new Date().getFullYear()} {APP_NAME}.{' '}
          <Link href="/privacy" className="hover:underline">Privacy</Link>{' '}
          |{' '}
          <Link href="/terms" className="hover:underline">Terms</Link>{' '}
          |{' '}
          <Link href="/" className="hover:underline">Back to Home</Link>
        </p>
      </footer>

    </div>
  );
}