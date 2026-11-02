export type FaqBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "command"; command: string; note?: string }
  | { type: "callout"; tone?: "info" | "warning"; text: string }
  | { type: "steps"; items: { title: string; description?: string }[] };

export interface FaqEntry {
  id: string;
  question: string;
  answer: FaqBlock[];
}

export interface FaqCategory {
  id: string;
  title: string;
  description: string;
  entries: FaqEntry[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Creating an account and finding your way around.",
    entries: [
      {
        id: "one-account-many-portals",
        question: "Can I use one account to buy vouchers from more than one hotspot business?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. Your account isn't tied to a single hotspot business - the same email and password work across every business's portal on this platform. You'll only ever see the vouchers and history that belong to the specific business you're currently browsing.",
          },
        ],
      },
      {
        id: "forgot-password",
        question: "I forgot my password. How do I reset it?",
        answer: [
          {
            type: "steps",
            items: [
              {
                title: "Open the sign-in page and choose \u201cForgot password?\u201d",
                description:
                  "It sits beside the Password field. Whatever you've already typed into the email box is carried over.",
              },
              {
                title: "Enter the email you signed up with",
                description:
                  "We'll send a reset link to that address if an account exists for it.",
              },
              {
                title: "Follow the link within an hour",
                description:
                  "Reset links expire. If yours has, request a new one from the same page.",
              },
            ],
          },
          {
            type: "callout",
            tone: "info",
            text: "No email after a few minutes? Check your spam folder, and make sure you're using the address you originally registered with.",
          },
        ],
      },
      {
        id: "become-a-business-owner-link",
        question: "I run a hotspot business - how do I get set up on this platform?",
        answer: [
          {
            type: "paragraph",
            text: "That's a separate, business-owner registration - see \"Becoming a Business Owner\" below for the full walkthrough. You can start it any time from the \"Join as a business owner\" link on the homepage or the login page.",
          },
        ],
      },
    ],
  },
  {
    id: "vouchers",
    title: "Buying & Using Vouchers",
    description: "Purchasing a plan and getting connected.",
    entries: [
      {
        id: "how-purchase-works",
        question: "How does buying a voucher work?",
        answer: [
          {
            type: "steps",
            items: [
              { title: "Pick a plan", description: "Browse the plans available at that business's portal and choose one." },
              { title: "Pay securely", description: "Payment is handled by Paystack - card details are never seen or stored by this platform." },
              { title: "Get your voucher", description: "As soon as payment is confirmed, a username and password are generated automatically for that hotspot." },
            ],
          },
        ],
      },
      {
        id: "wheres-my-voucher",
        question: "Where do I find my voucher after paying?",
        answer: [
          {
            type: "paragraph",
            text: "Right after a successful payment you're taken straight to your voucher. You can always get back to it (and see every voucher you've bought from that business) from the \"My Vouchers\" link on that business's portal.",
          },
        ],
      },
      {
        id: "paid-but-no-voucher",
        question: "I paid but my voucher says \"generation failed\" - what do I do?",
        answer: [
          {
            type: "callout",
            tone: "info",
            text: "Your payment went through - you haven't lost anything. This just means there was a temporary hiccup creating your login on the hotspot's router.",
          },
          {
            type: "paragraph",
            text: "Contact the hotspot business you bought from (not the platform) - their dashboard shows exactly this failure in a queue they can retry with one click, using the same voucher you already paid for.",
          },
        ],
      },
      {
        id: "voucher-expiry",
        question: "When does my voucher expire?",
        answer: [
          {
            type: "paragraph",
            text: "Timing starts from your first successful login on the hotspot, not from the moment you bought it - so an unused voucher doesn't start counting down while it sits in your account. Once you connect, it lasts for exactly the duration shown on the plan you purchased.",
          },
        ],
      },
    ],
  },
  {
    id: "becoming-a-business-owner",
    title: "Becoming a Business Owner",
    description: "Registering your own hotspot business on the platform.",
    entries: [
      {
        id: "onboarding-flow",
        question: "What does registering my business involve?",
        answer: [
          {
            type: "steps",
            items: [
              { title: "Business details", description: "Your business name and a portal address (e.g. yourbusiness) that your customers will use." },
              { title: "Choose a billing plan", description: "Pick how you want to pay the platform - see the next question for the options." },
              { title: "Bank details", description: "The account your customers' payments settle to - verified with your bank before you can continue." },
              { title: "Confirm", description: "For paid plans, you'll pay the first month right there to activate your account; the free plan activates immediately." },
            ],
          },
        ],
      },
      {
        id: "billing-plans-explained",
        question: "What billing plans are available, and what do they cost?",
        answer: [
          {
            type: "paragraph",
            text: "The platform offers a handful of billing plans, typically a mix of flat monthly fees, a percentage of each voucher sale, or a combination of both - each with its own limits and features.",
          },
          {
            type: "callout",
            tone: "info",
            text: "Exact plans and pricing are set by the platform and can change - the options and figures shown to you during registration (Step 2) are always the current, accurate ones.",
          },
        ],
      },
      {
        id: "paid-plan-first-payment",
        question: "Why am I asked to pay before my account is even created?",
        answer: [
          {
            type: "paragraph",
            text: "If you choose a plan with a monthly fee, that first month is charged during registration itself - your account is only created and activated once that payment succeeds. This also sets up automatic billing, so you won't need to manually pay again each month.",
          },
          {
            type: "paragraph",
            text: "If you cancel the payment prompt, nothing is created and nothing is charged - you can simply try again.",
          },
        ],
      },
    ],
  },
  {
    id: "billing",
    title: "Billing & Subscriptions",
    description: "Ongoing payments once your business is set up.",
    entries: [
      {
        id: "subscription-failed",
        question: "What happens if my monthly subscription payment fails?",
        answer: [
          {
            type: "paragraph",
            text: "Your account is marked past-due and the platform will attempt to notify you. Keep your payment method up to date with your bank to avoid an interruption to your portal.",
          },
        ],
      },
      {
        id: "switch-plan",
        question: "Can I switch billing plans after I've registered?",
        answer: [
          {
            type: "callout",
            tone: "warning",
            text: "There's currently no self-service way to switch your billing plan after registration. If you need to change plans, contact support directly.",
          },
        ],
      },
    ],
  },
  {
    id: "router-connection",
    title: "Connecting Your Router",
    description: "Setting up your MikroTik router so your portal can manage it.",
    entries: [
      {
        id: "what-is-winbox",
        question: "The setup mentions Winbox - what is that?",
        answer: [
          {
            type: "paragraph",
            text: "Winbox is MikroTik's own free tool for configuring their routers. It's a small program you install on your own computer (not the router itself) that connects to the router over your local network. If someone else originally set up your router, they likely already have it installed; otherwise it's a free download from MikroTik's website.",
          },
          {
            type: "callout",
            tone: "info",
            text: "You need to be on the same local network as the router to connect with Winbox - this one-time setup can't be done remotely.",
          },
        ],
      },
      {
        id: "why-wireguard",
        question: "Why do I need to run commands on my router at all?",
        answer: [
          {
            type: "paragraph",
            text: "Most routers sit behind your internet connection with no way for anything outside your network to reach them - which is normally exactly what you want. To let your dashboard manage vouchers on your router, we set up a private, encrypted tunnel (WireGuard) between your router and the platform. That one-time setup is the handful of commands the Register Router wizard walks you through.",
          },
        ],
      },
      {
        id: "wizard-shape",
        question: "What does the router registration wizard actually do?",
        answer: [
          {
            type: "steps",
            items: [
              { title: "Router details", description: "Your router's name and admin login, collected up front." },
              { title: "Connect", description: "A quick safety check, then two commands to create the tunnel and read your router's public key." },
              { title: "Finish", description: "A few final commands to complete the tunnel, then the platform verifies the connection automatically." },
            ],
          },
          {
            type: "callout",
            tone: "info",
            text: "The exact commands you'll paste are generated fresh, live, inside the wizard each time - they're unique per attempt, so they're never shown or reused anywhere outside the dialog itself, including here.",
          },
        ],
      },
      {
        id: "not-ready-old-routeros",
        question: "The check says my RouterOS is too old - what now?",
        answer: [
          {
            type: "paragraph",
            text: "WireGuard requires RouterOS version 7 or newer. If you're on an older version, you'll need to update it first: in Winbox, go to System → Packages → Check For Updates.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Updating RouterOS requires a reboot, which will briefly disconnect anyone currently using your hotspot - plan this for a quiet time, not during business hours.",
          },
        ],
      },
      {
        id: "not-ready-already-in-use",
        question: "The check says something is already using this connection name - what now?",
        answer: [
          {
            type: "paragraph",
            text: "Each attempt generates its own unique connection name, so this is almost always just bad luck on that specific attempt, not a real conflict.",
          },
          {
            type: "callout",
            tone: "info",
            text: "Click \"generate a new connection name and try again\" right below the check command in the wizard, then re-run it. This resolves it in nearly every case with no need to contact anyone.",
          },
        ],
      },
      {
        id: "useful-diagnostic-commands",
        question: "Is there anything I can check myself if I run into trouble?",
        answer: [
          {
            type: "paragraph",
            text: "These are safe to run any time in a Winbox terminal - they only read information, they don't change anything on your router:",
          },
          {
            type: "command",
            command: "/system/resource print",
            note: "Shows your RouterOS version, among other things.",
          },
          {
            type: "command",
            command: "/interface/wireguard print",
            note: "Lists any WireGuard connections already set up on this router.",
          },
          {
            type: "command",
            command: "/interface/wireguard/peers print",
            note: "Shows what each WireGuard connection is linked to.",
          },
        ],
      },
      {
        id: "direct-ip-advanced",
        question: "There's a \"direct IP\" option too - should I use that instead?",
        answer: [
          {
            type: "callout",
            tone: "warning",
            text: "For almost everyone, no - use WireGuard. Direct IP is an advanced option, only relevant if your router already has a public IP address exposed to the internet.",
          },
          {
            type: "paragraph",
            text: "Exposing your router's admin access directly to the internet carries real security risk if you're not sure what that involves. It exists mainly as a fallback for specific setups, not as a typical path - if in doubt, use the WireGuard flow instead.",
          },
        ],
      },
      {
        id: "router-offline",
        question: "My router shows \"offline\" in the dashboard - what should I check?",
        answer: [
          {
            type: "list",
            items: [
              "Confirm the router has power and an active internet connection.",
              "Confirm nothing on the router (a firmware update, a manual config change) altered or removed the WireGuard connection since it was set up.",
              "Re-open the router in your dashboard and let it re-verify the connection - a brief network hiccup is often all it was.",
            ],
          },
        ],
      },
    ],
  },
];

/** A block's prose as plain text, for FAQ search and structured data. */
export function faqBlockText(block: FaqBlock): string {
  switch (block.type) {
    case "paragraph":
    case "callout":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "command":
      return `${block.command} ${block.note ?? ""}`;
    case "steps":
      return block.items
        .map((item) => `${item.title} ${item.description ?? ""}`)
        .join(" ");
    default:
      return "";
  }
}

/**
 * A one-paragraph plain-text summary of an answer.
 *
 * The landing page shows a handful of these questions and needs a short
 * answer for each, while the FAQ page renders the full block list. This
 * keeps both reading the same entries: the landing page selects by id
 * and summarises, rather than carrying its own copy of the questions
 * that then drifts from the real ones.
 *
 * Falls through the block types by how well each summarises on its own.
 * Not every entry leads with a paragraph - some are a set of steps or a
 * single callout - so this has to cope with all of them rather than
 * assuming the shape of the ones that happen to exist today.
 */
export function faqSummary(answer: FaqBlock[]): string {
  const paragraph = answer.find((block) => block.type === "paragraph");
  if (paragraph) return paragraph.text;

  const callout = answer.find((block) => block.type === "callout");
  if (callout) return callout.text;

  const list = answer.find((block) => block.type === "list");
  if (list) return list.items.join(" ");

  const steps = answer.find((block) => block.type === "steps");
  if (steps) return steps.items.map((item) => item.title).join(" ");

  return "";
}
