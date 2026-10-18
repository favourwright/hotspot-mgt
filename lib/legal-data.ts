/** A run of text, or a link inside a sentence. */
export type LegalInline = string | { label: string; href: string };

export type LegalBlock =
  | { type: "paragraph"; text: LegalInline[] }
  | { type: "list"; items: LegalInline[][]; ordered?: boolean }
  | { type: "callout"; tone?: "info" | "warning"; text: LegalInline[] }
  | { type: "definitions"; items: { term: string; text: LegalInline[] }[] }
  | { type: "table"; head: string[]; rows: LegalInline[][][] };

export interface LegalSection {
  id: string;
  title: string;
  description: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
}

export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  description:
    "How we collect, use and protect your personal information when you use our hotspot management platform.",
  updated: "2026-10-17",
  sections: [
    {
      id: "who-we-are",
      title: "1. Who we are",
      description: "What this policy covers and who operates the platform.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "This platform is operated by Knomad Limited, a company registered in Nigeria with registration number 7168274. This policy describes how we handle your information when you use our service to buy internet access or run your own hotspot business.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Contact address for privacy requests: support@ogawifi.online",
          ],
        },
      ],
    },
    {
      id: "who-this-applies-to",
      title: "2. Who this applies to",
      description: "The two kinds of people this policy covers.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "This policy covers two groups:",
          ],
        },
        {
          type: "list",
          items: [
            [
              "Customers: people who buy vouchers to access a hotspot. We collect your email address, your account credentials, your payment details and the vouchers you purchase.",
            ],
            [
              "Business owners: people who run a hotspot and use this platform to sell access. We collect everything above, plus your business details, bank account, router connection credentials and the customers and sales that belong to your business.",
            ],
          ],
        },
        {
          type: "paragraph",
          text: [
            "Your account is one account across every business on the platform. A business only ever sees the customers and vouchers that belong to it, but the same email and password work across every business's portal.",
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      title: "3. What we collect",
      description: "The personal data we hold, by category.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Everything is stored in our secure cloud database. We collect:",
          ],
        },
        {
          type: "table",
          head: ["Category", "What we hold"],
          rows: [
            [
              ["Your account"],
              [
                "Email address, Account identifier, your role, when you registered",
              ],
            ],
            [
              ["Your business (owners only)"],
              [
                "Business name, owner email, bank name, account number, account name",
              ],
            ],
            [
              ["Your activity at a business"],
              [
                "Account identifier, email, total vouchers bought, total spent",
              ],
            ],
            [
              ["Vouchers you buy"],
              [
                "Buyer account identifier, buyer email, hotspot username and password, plan details, location, purchase time, expiry time, payment reference",
              ],
            ],
            [
              ["Your chosen credentials"],
              [
                "The wifi username and password you set for yourself at a particular business. Readable by that business, because the router needs the word itself",
              ],
            ],
            [
              ["Payments"],
              [
                "Buyer account identifier, buyer email, amount, Paystack reference, platform and tenant shares",
              ],
            ],
            [
              ["Router details (owners only)"],
              [
                "Router address, router admin credentials (yours, not a customer's)",
              ],
            ],
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text: [
            "The business that issued your voucher can see its hotspot password, because the router it unlocks needs the word itself. Treat it as a door code for that venue, not as a password, and never reuse one you use elsewhere. This is not your account password, which we never store, and your code at one business is separate from your code at every other one.",
          ],
        },
      ],
    },
    {
      id: "why-we-collect-it",
      title: "4. Why we collect it",
      description: "What we use your information for.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "We collect and use your information to:",
          ],
        },
        {
          type: "list",
          items: [
            ["Create and maintain your account"],
            [
              "Deliver the hotspot access you paid for, by creating your login on the business's router",
            ],
            ["Process payments and settle them to the correct account"],
            [
              "Let business owners manage their own locations, plans and customers",
            ],
            ["Provide support when something goes wrong"],
            [
              "Send transactional emails (payment confirmations, password resets, expiry reminders)",
            ],
          ],
        },
        {
          type: "paragraph",
          text: [
            "We do not use your information for advertising or tracking. There is no analytics, no tag manager, no session recorder and no advertising pixel anywhere in this service.",
          ],
        },
      ],
    },
    {
      id: "who-else-sees-it",
      title: "5. Who else sees it",
      description: "Third parties that process your data.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Your information reaches these processors:",
          ],
        },
        {
          type: "table",
          head: ["Processor", "What reaches them", "Why"],
          rows: [
            [
              ["Our authentication and database provider"],
              ["Account credentials and every record above"],
              ["Authentication and secure data storage"],
            ],
            [
              [
                {
                  label: "Paystack",
                  href: "https://paystack.com/terms",
                },
              ],
              [
                "Payment details, buyer email, amounts; they perform the revenue split",
              ],
              ["Payment processing"],
            ],
            [
              ["Our email service provider"],
              ["Recipient address and the contents of each email sent"],
              ["Email delivery"],
            ],
            [
              ["Our DNS hosting provider"],
              ["Domain name resolution only, no personal data"],
              ["DNS hosting"],
            ],
            [
              ["Our scheduled task service"],
              ["No personal data, only trigger URLs"],
              ["Automated job scheduling"],
            ],
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "6. Cookies and sessions",
      description: "What we store in your browser.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "We use exactly two cookies, both first-party and both strictly necessary for signing in:",
          ],
        },
        {
          type: "list",
          items: [
            [
              "A sign-in cookie, which is what keeps you signed in as you move between pages and between the businesses you use. It expires after five days.",
            ],
            [
              "A companion cookie that carries no identity at all. It exists only so a page can tell whether you are likely to be signed in before asking our servers.",
            ],
          ],
        },
        {
          type: "paragraph",
          text: [
            "There are no optional or analytics cookies. This is why there is no consent banner.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "7. How long we keep it",
      description: "What is deleted and when.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "When a voucher expires, we remove the hotspot user from the router 14 days later. The database records are kept. Payment and voucher records are retained for 7 years from the date of the transaction, after which they may be archived or deleted in accordance with our data management policies.",
          ],
        },
      ],
    },
    {
      id: "security",
      title: "8. Security",
      description: "What is protected and what is not.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Your account password is handled by our authentication provider and is never stored by us. Router admin credentials, which business owners supply, are held in a store that browsers cannot read from and are never sent back to a browser: only our servers ever see them.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "A hotspot password is the exception, and it is worth understanding why. It has to be reversible, because the router it unlocks needs the literal word, so the business that issued it can see it in their own dashboard. Treat it as a door code for that venue rather than as a password, and never reuse one you use anywhere else.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      title: "9. Your rights",
      description: "How to access, correct or delete your information.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "You can request access to your information, request corrections, or request deletion by contacting support@ogawifi.online.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Business owners: deleting your account does not automatically delete your business's records (customers, vouchers, payments). Contact us to discuss what should happen to those records.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Regulatory obligations: We comply with the Nigeria Data Protection Act (NDPA) 2023. For data protection inquiries, contact us at the address provided below.",
          ],
        },
      ],
    },
    {
      id: "children",
      title: "10. Children",
      description: "Age restrictions for using this service.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "This service is not directed at children. You must be at least 18 years old to register an account or make a purchase.",
          ],
        },
      ],
    },
    {
      id: "changes",
      title: "11. Changes to this policy",
      description: "How we handle updates.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "We may update this policy from time to time. The date at the top shows when it was last updated. Continued use after an update means you accept the changes.",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "12. Contact",
      description: "How to reach us.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Questions about this policy, or requests to exercise your rights: support@ogawifi.online.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "This policy is governed by the laws of the Federal Republic of Nigeria, and any disputes will be subject to the exclusive jurisdiction of the courts of Nigeria.",
          ],
        },
      ],
    },
  ],
};

export const ACCEPTABLE_USE_POLICY: LegalDocument = {
  title: "Acceptable Use Policy",
  description:
    "The rules for using this platform, for both businesses operating a hotspot and customers buying access.",
  updated: "2026-10-17",
  sections: [
    {
      id: "applies-to",
      title: "1. Who this applies to",
      description: "What this policy covers.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "This policy applies to everyone who uses this platform: businesses operating a hotspot, and customers buying access. It describes what you must not do while using the service.",
          ],
        },
      ],
    },
    {
      id: "definitions",
      title: "2. Definitions",
      description: "Terms used in this policy.",
      blocks: [
        {
          type: "definitions",
          items: [
            {
              term: "Platform",
              text: [
                "This service: the web application, the APIs, the router connection, and the hosted customer portals.",
              ],
            },
            {
              term: "Business",
              text: [
                "A hotspot operator who has registered on the platform and connected a router.",
              ],
            },
            {
              term: "Customer",
              text: [
                "A person who buys a voucher to access a hotspot operated by a business.",
              ],
            },
            {
              term: "Hotspot",
              text: [
                "The wifi network a business operates, managed through this platform.",
              ],
            },
            {
              term: "Voucher",
              text: [
                "A username and password that grants access to a hotspot for a specific duration.",
              ],
            },
          ],
        },
      ],
    },
    {
      id: "business-obligations",
      title: "3. Businesses operating a hotspot",
      description: "What a business must not do.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "If you operate a hotspot through this platform, you must not:",
          ],
        },
        {
          type: "list",
          items: [
            [
              "Resell access you are not entitled to resell. The network you connect to this platform must be one you operate or are authorised to manage.",
            ],
            [
              "Misrepresent what a voucher buys. The duration, data limit and device count on each plan must match what is enforced on the router.",
            ],
            [
              "Use the platform without the right to operate the network. If you do not own the venue or the internet connection, you must have the owner's permission to run a hotspot there.",
            ],
          ],
        },
      ],
    },
    {
      id: "customer-obligations",
      title: "4. Customers using a hotspot",
      description: "What anyone using a hotspot must not do.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "If you buy access through this platform, you must not:",
          ],
        },
        {
          type: "list",
          items: [
            [
              "Use the service for anything unlawful. This includes but is not limited to: distributing illegal content, harassment, fraud, or any activity prohibited under the laws of the Federal Republic of Nigeria.",
            ],
            [
              "Attempt intrusion or attacks. You must not scan, probe or test the vulnerability of any system or network, whether the platform's own infrastructure or another customer's devices.",
            ],
            [
              "Interfere with the network or other users. You must not degrade, disrupt or disable the hotspot for others, whether through excessive bandwidth use, flooding, or any other means.",
            ],
            [
              "Circumvent voucher limits. If a plan is sold as \"1 device\", you must not share the login across more devices than the plan allows.",
            ],
            [
              "Automate abuse. You must not use bots, scrapers or any automated system to purchase vouchers, overload the platform, or extract data you are not entitled to.",
            ],
          ],
        },
      ],
    },
    {
      id: "credential-sharing",
      title: "5. Credential sharing and device limits",
      description: "How device counts are enforced.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Each plan has a device count: the number of devices that can be signed in with the same voucher at the same time. This limit is enforced by the router, not by this platform. If a plan is sold as \"1 device\", the router will disconnect you when a second device logs in with the same credentials.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Sharing your login with more people than the plan allows is a breach of this policy, even if the router's own enforcement makes it impractical.",
          ],
        },
      ],
    },
    {
      id: "payments",
      title: "6. Payments and chargebacks",
      description: "How payments are handled.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Payments are processed by ",
            {
              label: "Paystack",
              href: "https://paystack.com/terms",
            },
            " and are split at the moment they clear: the business receives their share and the platform receives the fee. Refunds are handled by the business you bought from, not by the platform.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Filing a chargeback for a voucher you received and used is fraud. If you have a dispute with a business, contact them directly before escalating to your bank.",
          ],
        },
      ],
    },
    {
      id: "reporting",
      title: "7. Reporting abuse",
      description: "How to report a breach of this policy.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "If you believe someone is breaching this policy, contact support@ogawifi.online. Include as much detail as possible: what happened, when it happened, and any evidence you have.",
          ],
        },
      ],
    },
    {
      id: "enforcement",
      title: "8. What happens when this policy is broken",
      description: "How breaches are handled.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "If you breach this policy, we may suspend your account. For a business, suspension makes your portal inaccessible platform-wide: your customers cannot buy vouchers and you cannot manage your locations or plans. For a customer, suspension means you cannot buy access at any business on this platform.",
          ],
        },
        {
          type: "paragraph",
          text: [
            "Suspension is not the only response. Depending on the breach, we may also: issue a warning, terminate your account, report the matter to law enforcement, or take other action we consider appropriate.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text: [
            "Suspension is immediate and is not preceded by a warning for serious breaches. Less serious breaches may result in a warning first.",
          ],
        },
      ],
    },
    {
      id: "aup-changes",
      title: "9. Changes to this policy",
      description: "How we handle updates.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "We may update this policy from time to time. The date at the top shows when it was last updated. Continued use after an update means you accept the changes.",
          ],
        },
      ],
    },
    {
      id: "aup-contact",
      title: "10. Contact",
      description: "How to reach us.",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Questions about this policy: support@ogawifi.online.",
          ],
        },
      ],
    },
  ],
};
