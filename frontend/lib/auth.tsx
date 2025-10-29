import { jwtDecode } from 'jwt-decode'
// Save JWT token (after login)
export function saveToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("token", token);
  }
}

// Get JWT token (for API calls or checking login status)
export function getToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("token");
  }
  return null;
}

// Logout: remove token and redirect to login page
export function logout() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }
}

export function getCurrentUserId(): string | null {
  if (typeof window === "undefined") {
    // Cannot access localStorage or decode token on server
    return null;
  }

  const token = getToken();
  if (!token) {
    return null; // Not logged in
  }

  try {
    const decodedToken: { id: string;[key: string]: any } = jwtDecode(token);


    const currentTime = Date.now() / 1000; // Convert to seconds
    if (decodedToken.exp && decodedToken.exp < currentTime) {
      console.warn("Token expired");
      logout(); // Log out if expired
      return null;
    }

    return decodedToken.id; // Return the user ID from the token payload
  } catch (error) {
    console.error("Failed to decode token:", error);
    localStorage.removeItem("token");
    return null;
  }
}