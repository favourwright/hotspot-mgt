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
        id: "confirm-email",
        question: "Do I have to confirm my email address?",
        answer: [
          {
            type: "paragraph",
            text: "It won't stop you buying, connecting or running a business, because you may be signing up from behind a hotspot with no way to reach your inbox. It's still worth doing once you're online: your voucher details are emailed to that address, so a typo means your only lasting copy goes nowhere.",
          },
        ],
      },
      {
        id: "become-a-business-owner-link",
        question: "I run a hotspot business - how do I get set up on this platform?",
        answer: [
          {
            type: "paragraph",
            text: "That's a separate, business-owner registration - see \"Becoming a Business Owner\" below for the full walkthrough. You can start it any time from \"Start selling\" on the homepage or \"Get started\" on the sign-in page.",
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
              {
                title: "Sign in or create an account",
                description:
                  "You need an account to buy. You can create one from the hotspot's own sign-in page, even before you have internet access.",
              },
              {
                title: "Pick a plan",
                description:
                  "Browse the plans available at that business's portal and choose one.",
              },
              {
                title: "Pay securely",
                description:
                  "Payment is handled by Paystack - card details are never seen or stored by this platform. The amount shown at checkout is what you pay, including any processing fee.",
              },
              {
                title: "Get your voucher",
                description:
                  "As soon as payment is confirmed, a username and password are generated automatically for that hotspot and emailed to you.",
              },
            ],
          },
        ],
      },
      {
        id: "connect-with-voucher",
        question: "How do I connect once I have a voucher?",
        answer: [
          {
            type: "paragraph",
            text: "Join the business's Wi-Fi and enter your username and password on the sign-in page that opens. On a business using our portal that's the \"Have a voucher?\" form, which doesn't need an account. If you bought from that page on the device you're connecting, you may be signed in automatically.",
          },
        ],
      },
      {
        id: "wheres-my-voucher",
        question: "Where do I find my voucher after paying?",
        answer: [
          {
            type: "paragraph",
            text: "Right after a successful payment you're taken straight to your voucher, and the details are emailed to you. You can always get back to it (and see every voucher you've bought from that business) from the \"My Vouchers\" link on that business's portal.",
          },
        ],
      },
      {
        id: "buying-for-someone-else",
        question: "Can I buy a voucher for someone else?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. If you already hold a login with that business, checkout asks who the purchase is for. Choose the option for someone else and you get a new code to pass on, with your own login left untouched. Choose yourself and the purchase goes onto your existing login where it can.",
          },
        ],
      },
      {
        id: "renew-early",
        question: "What happens if I renew before my voucher runs out?",
        answer: [
          {
            type: "paragraph",
            text: "Normally the new plan is added to what you have left: your unused time and data carry over and you keep the same login.",
          },
          {
            type: "callout",
            tone: "info",
            text: "Each business decides how its renewals work, and some restart the plan from the moment you pay instead. That can end your access sooner than your current voucher would, so checkout tells you before you pay.",
          },
          {
            type: "paragraph",
            text: "You can't top up a voucher on the same plan that you haven't used yet, because its time hasn't started. Use it first, or buy for someone else.",
          },
        ],
      },
      {
        id: "choose-own-login",
        question: "Can I choose my own Wi-Fi username and password?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. Open \"Account\" on that business's portal and fill in \"Your wifi login\". A short suffix is added to the username you pick. Your vouchers then use that login instead of a random code. If you already have a live voucher at that location, a new plan gets a random code and your current login keeps running.",
          },
        ],
      },
      {
        id: "paid-page-closed",
        question: "My page closed or lost connection while I was paying. Did I lose my money?",
        answer: [
          {
            type: "paragraph",
            text: "No. We confirm payments with Paystack directly, whether or not your browser survived, so your voucher is still issued and emailed to you - usually within minutes, and it will appear under \"My Vouchers\".",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Please don't pay again. If nothing has appeared after about 30 minutes, contact the hotspot business with your Paystack receipt.",
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
            text: "Contact the hotspot business you bought from (not the platform) - their dashboard shows exactly this failure in a queue they can retry with one click, using the same voucher you already paid for. We'll email you as soon as it's active.",
          },
        ],
      },
      {
        id: "voucher-expiry",
        question: "When does my voucher expire?",
        answer: [
          {
            type: "paragraph",
            text: "Timing starts from your first successful login on the hotspot, not from the moment you bought it - so an unused voucher doesn't start counting down while it sits in your account. Once you connect, it lasts for exactly the duration shown on the plan you purchased, and the clock keeps running even while you're disconnected.",
          },
          {
            type: "paragraph",
            text: "If your plan has a data limit, access can also end when that runs out. We email you about an hour before your time is up.",
          },
        ],
      },
      {
        id: "private-address-notice",
        question: "The sign-in page mentions a private or random address. Will that stop me connecting?",
        answer: [
          {
            type: "paragraph",
            text: "No. You sign in with a username and password, and that works either way. Phones use a private address by default, and it can change between visits. That can stop the hotspot recognising your device when you return, and can count one phone as a new device on plans that limit how many can connect.",
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
            type: "paragraph",
            text: "Once you're signed in, it's four short steps and you can do them in one sitting.",
          },
          {
            type: "steps",
            items: [
              {
                title: "Business details",
                description:
                  "Your business name and a portal address (e.g. yourbusiness) that your customers will use.",
              },
              {
                title: "Choose a billing plan",
                description:
                  "Pick how you want to pay the platform - see the next question for the options.",
              },
              {
                title: "Bank details",
                description:
                  "The account your customers' payments settle to - verified with your bank before you can continue.",
              },
              {
                title: "Confirm",
                description:
                  "Review everything and enter a promo code if you have one. Plans with a fee due today take the payment here; otherwise your account activates immediately.",
              },
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
            text: "The platform offers a handful of billing plans, typically a mix of flat monthly fees, a percentage of each voucher sale, or a combination of both. Each sets how many routers, locations and active customers you can have, and some include a free trial or bundle addons.",
          },
          {
            type: "callout",
            tone: "info",
            text: "Exact plans and pricing are set by the platform and can change - the options and figures shown to you during registration (Step 2) are always the current, accurate ones.",
          },
        ],
      },
      {
        id: "active-customers-limit",
        question: "How are \"active customers\" counted?",
        answer: [
          {
            type: "paragraph",
            text: "An active customer is anyone who has paid you in the last 30 days. Someone who stops buying stops counting, with nothing for you to do.",
          },
          {
            type: "paragraph",
            text: "If you reach your limit, people who have never bought from you can't buy until the count falls or you move to a larger plan. Anyone who has bought from you before can always buy again, even if that takes you over the limit.",
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
            text: "The exceptions are a plan with a free trial or a promo code that covers the fee, where nothing is charged at signup, and a partial promo discount, where the reduced amount is charged once. In those cases you pay the full fee from your settings when the offer ends, and that payment starts automatic billing.",
          },
          {
            type: "paragraph",
            text: "If you cancel the payment prompt, nothing is created and nothing is charged - you can simply try again.",
          },
        ],
      },
      {
        id: "after-registering",
        question: "I've registered. What do I do next?",
        answer: [
          {
            type: "steps",
            items: [
              {
                title: "Register your router",
                description:
                  "Open Routers in your dashboard and follow the wizard - it takes about five minutes.",
              },
              {
                title: "Add a location",
                description:
                  "A location is the place your hotspot serves, backed by a router that's online.",
              },
              {
                title: "Create your plans",
                description:
                  "Set the price, duration and data limit for what you want to sell at that location.",
              },
              {
                title: "Start selling",
                description:
                  "Share your portal address with customers, or install the captive portal so buying is built into your Wi-Fi sign-in page.",
              },
            ],
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
        id: "how-payouts-work",
        question: "How do I get paid for voucher sales?",
        answer: [
          {
            type: "paragraph",
            text: "Paystack splits each payment automatically: your share settles to the bank account you registered and the platform's commission, if your plan has one, goes to the platform. Every sale is listed under Transactions in your dashboard.",
          },
        ],
      },
      {
        id: "change-bank-account",
        question: "How do I change my bank account?",
        answer: [
          {
            type: "paragraph",
            text: "Your bank details are shown in Settings but can't be changed from there. Email support@ogawifi.online and we'll help you update them.",
          },
        ],
      },
      {
        id: "trial-ending",
        question: "What happens when my free trial or promo ends?",
        answer: [
          {
            type: "paragraph",
            text: "We email you before it ends and again when your fee is due. Pay from Settings to start your subscription. New sales pause if the fee stays unpaid after a short grace period, and your dashboard and email give the exact date.",
          },
          {
            type: "callout",
            tone: "info",
            text: "You can use \"Pay early\" in Settings during a trial or promo without losing any free days. Your payment covers the first month after the offer ends.",
          },
        ],
      },
      {
        id: "subscription-failed",
        question: "What happens if my monthly subscription payment fails?",
        answer: [
          {
            type: "paragraph",
            text: "Your account is marked past-due and we email you. Paystack retries your card by itself over the next few days, and your sales carry on while it does.",
          },
          {
            type: "paragraph",
            text: "If the subscription ends without a successful payment, your fee becomes due. New sales pause if it stays unpaid after a short grace period, and paying from Settings restarts them.",
          },
        ],
      },
      {
        id: "sales-paused",
        question: "My sales are paused because my plan fee is overdue. What does that mean?",
        answer: [
          {
            type: "list",
            items: [
              "New voucher sales stop on your portal, and you can't make changes in your dashboard such as adding plans or routers.",
              "Vouchers you've already sold keep working, and nothing is deleted.",
              "You can still view your dashboard and retry failed vouchers.",
            ],
          },
          {
            type: "paragraph",
            text: "To get going again, pay the fee from Settings or move to a plan with no monthly fee, and sales restart straight away. If you move to a cheaper paid plan, you still need to pay its fee to restart them. Your public pages stay up throughout.",
          },
        ],
      },
      {
        id: "switch-plan",
        question: "Can I switch billing plans after I've registered?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. Open Settings and choose \"Change plan\". The move takes effect immediately, and your new plan's commission applies to sales from then on. Nothing is deleted when you move to a smaller plan: anything over its limits keeps running, but you can't add more until you're back under them. You'll be asked to confirm this first.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "If you're paying a monthly fee by subscription, email support@ogawifi.online before you switch so we can make sure your card is billed the right amount.",
          },
        ],
      },
      {
        id: "cancel-subscription",
        question: "How do I cancel my subscription?",
        answer: [
          {
            type: "paragraph",
            text: "Open Settings and choose to cancel on your billing plan. This stops it renewing, and your vouchers, customers and routers aren't affected.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "A plan with a monthly fee still has to be paid for you to keep selling, so new sales pause if the fee is left unpaid. If you want to stop paying and keep selling, a plan with no monthly fee is the better option - see the question above about switching.",
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
        id: "which-routers",
        question: "Which routers are supported?",
        answer: [
          {
            type: "paragraph",
            text: "MikroTik routers, which is the only brand we support today. To use the standard WireGuard setup, the router needs RouterOS version 7 or newer.",
          },
        ],
      },
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
              {
                title: "Router details",
                description:
                  "Your router's name and admin login, collected up front.",
              },
              {
                title: "Connect your router",
                description:
                  "A quick safety check, then two commands to create the tunnel and read your router's public key.",
              },
              {
                title: "Finish setup",
                description:
                  "A few final commands to complete the tunnel, then the platform automatically checks the connection and your router login.",
              },
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
        id: "router-limits",
        question: "How many routers and locations can I have?",
        answer: [
          {
            type: "paragraph",
            text: "Your billing plan sets the limits, and the add buttons in your dashboard tell you when you've reached one. Deleting a router or location you no longer use frees up its place, or you can move to a larger plan in Settings.",
          },
          {
            type: "callout",
            tone: "info",
            text: "Each router can back only one location, so you need a router for every location. A router has to be online to be added to a location, and you can only delete it once it has no locations.",
          },
        ],
      },
      {
        id: "not-ready-old-routeros",
        question: "The check says my RouterOS is too old - what now?",
        answer: [
          {
            type: "paragraph",
            text: "WireGuard requires RouterOS version 7 or newer. If you're on an older version, you'll need to update it first: in Winbox, go to System \u2192 Packages \u2192 Check For Updates.",
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
            text: "Click \"generate a new connection name and try again\" right below the check command in the wizard, then re-run it. This resolves it in nearly every case. If it still says NOT READY, stop there and contact support with the message it shows.",
          },
        ],
      },
      {
        id: "verify-failed",
        question: "The wizard couldn't connect after I ran the commands - what now?",
        answer: [
          {
            type: "paragraph",
            text: "The wizard tells you which of two problems it found, and shows a safe command to confirm it. Check last-handshake in that command's output:",
          },
          {
            type: "list",
            items: [
              "If it says \"never\", your router hasn't reached our server. Check that you pasted the right public key, that the peer command ran without an error, and that your network isn't blocking outgoing UDP traffic on port 51820.",
              "If it shows a recent time, the tunnel is working and the router isn't responding through it. Re-run the IP address and firewall commands and check that neither gave an error.",
            ],
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
            note: "Shows what each WireGuard connection is linked to, and when it last reached the other side (last-handshake).",
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
            text: "For almost everyone, no - use WireGuard. Direct IP is an advanced option, only relevant if your router already has a public IP address exposed to the internet, with www-ssl enabled and reachable on port 443.",
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
            type: "paragraph",
            text: "We check your routers about every 15 minutes and email you when one goes offline. The status updates by itself on a later check once the router is reachable again, so a brief network hiccup clears without you doing anything.",
          },
          {
            type: "list",
            items: [
              "Confirm the router has power and an active internet connection.",
              "Confirm nothing on the router (a firmware update, a manual config change) altered or removed the WireGuard connection since it was set up.",
              "Run /interface/wireguard/peers print in Winbox and look at last-handshake to see whether the router is still reaching us.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "captive-portal-addons",
    title: "Captive Portal & Addons",
    description: "Optional features for your Wi-Fi sign-in page and your own systems.",
    entries: [
      {
        id: "what-are-addons",
        question: "What are addons?",
        answer: [
          {
            type: "paragraph",
            text: "Addons are features sold separately from your billing plan, and some plans include them. There are two: Captive Portal, and API Access, which lets your own systems read your data with API keys and approve or refuse purchases with decision hooks. Open Addons in your dashboard for current prices and to buy one. The technical documentation is on the Developers page.",
          },
          {
            type: "callout",
            tone: "info",
            text: "An addon is paid for separately from your plan fee, so being paid up on one doesn't cover the other.",
          },
        ],
      },
      {
        id: "what-is-captive-portal",
        question: "What does the Captive Portal addon do?",
        answer: [
          {
            type: "paragraph",
            text: "It replaces your router's Wi-Fi sign-in page with a branded one that we host. Customers who join your Wi-Fi can enter a voucher or buy a plan right there, without needing internet access first.",
          },
        ],
      },
      {
        id: "install-portal",
        question: "How do I install the captive portal?",
        answer: [
          {
            type: "paragraph",
            text: "Once you have the addon, open Locations in your dashboard, open the menu on the location you want and choose \"Install captive portal\". We configure the router over your existing connection, so there are no commands to run.",
          },
        ],
      },
      {
        id: "uninstall-portal",
        question: "Can I go back to my old sign-in page?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. Choose to uninstall the portal from the same menu. We keep a record of the sign-in pages your router was using and point it back to them. You can always uninstall, even if your addon has lapsed.",
          },
        ],
      },
      {
        id: "portal-addon-lapses",
        question: "What happens if my Captive Portal addon lapses?",
        answer: [
          {
            type: "paragraph",
            text: "Your portal page stops serving its sign-in form and plans, and shows customers a neutral \"unavailable\" message that says nothing about billing. A subscription gets a short grace period first, because Paystack retries failed payments. Paying again brings the page back with no reinstall.",
          },
        ],
      },
      {
        id: "portal-settings",
        question: "Can I put my support number on the portal?",
        answer: [
          {
            type: "paragraph",
            text: "Yes. In Settings you can add a support phone number, with an option to mark it as WhatsApp. You can also turn off the note about private addresses shown under the Connect button.",
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
