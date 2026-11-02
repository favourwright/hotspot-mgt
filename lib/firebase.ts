import { initializeApp, getApps, getApp, FirebaseApp } from "@firebase/app";
import { getAuth, Auth } from "@firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

// Check if Firebase config is valid
const isConfigValid = firebaseConfig.apiKey && firebaseConfig.projectId;

// Initialize Firebase only if it hasn't been initialized yet and config is valid
let app: FirebaseApp | undefined;
let auth: Auth | undefined;

if (typeof window !== "undefined" && isConfigValid) {
  // Only initialize on client side with valid config
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApp();
    }
    
    auth = getAuth(app);
  } catch (error) {
    console.error("Firebase initialization error:", error);
    // Set to undefined so app can still render without Firebase
    app = undefined;
    auth = undefined;
  }
}

// Auth only, deliberately. The browser has no Firestore access at all: every
// read goes through an API route, and firestore.rules denies the client SDK
// outright. `npm run build` fails if the Firestore SDK reappears in a chunk
// (scripts/check-client-bundle.mts).
export { auth };
