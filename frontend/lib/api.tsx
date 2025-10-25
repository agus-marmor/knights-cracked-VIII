const USE_MOCK = true;

export async function login(email: string, password: string) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 500));
    if (email === "test@example.com" && password === "password") return { token: "fake-jwt-token" };
    throw new Error("Invalid credentials");
  }
  const res = await fetch("http://localhost:5000/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include", // Include cookies for session management
  });
  
  if (!res.ok) throw new Error("Login failed");
  return res.json();
}