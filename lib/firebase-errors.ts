export function getFirebaseErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    "auth/email-already-in-use": "An account with this email already exists",
    "auth/weak-password": "Password must be at least 8 characters",
    "auth/user-not-found": "No account found with this email",
    "auth/wrong-password": "Incorrect password",
    "auth/too-many-requests": "Too many attempts. Please try again later",
    "auth/invalid-email": "Please enter a valid email address",
    "auth/invalid-credential": "Invalid email or password",
    "auth/network-request-failed": "Network error. Please check your connection",
  };

  return errorMessages[errorCode] || "Something went wrong. Please try again";
}
