"use client";

import { useState } from "react";
import { signup, login } from "@/lib/api"; 
import { saveToken } from "@/lib/auth"; 
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // --- Basic Validation ---
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    
    setError("");
    setIsLoading(true);

    try {
      // --- Create Account ---
      await signup(username, email, password);
      
      // --- Auto Login ---
      const loginData = await login(email, password); 
      
      // --- Save Token ---
      saveToken(loginData.token);

      // --- Redirect to Dashboard ---
      router.push("/dashboard"); 

    } catch (err: any) {
      setError(err.message || "Signup failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="h-screen w-screen flex items-center pl-20 bg-right bg-cover bg-no-repeat"
      style={{
        backgroundImage: "url('/background.jpg')",
      }}
    >
      <div className="bg-slate-900/90 p-8 rounded-xl shadow-lg w-full max-w-sm text-gray-100">
        
        <h2 className="text-2xl font-semibold mb-6 tracking-wider text-center">SIGN UP</h2>
        
        <form onSubmit={handleSubmit}>
          {/* --- Username Field --- */}
          <div className="mb-4">
            <label htmlFor="username" className="block text-xs font-semibold text-gray-300 mb-2 tracking-wider">USERNAME</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full p-2.5 bg-slate-800/60 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* --- Email Field --- */}
          <div className="mb-4">
            <label htmlFor="email" className="block text-xs font-semibold text-gray-300 mb-2 tracking-wider">EMAIL</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full p-2.5 bg-slate-800/60 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* --- Password Field --- */}
          <div className="mb-4">
            <label htmlFor="password" className="block text-xs font-semibold text-gray-300 mb-2 tracking-wider">PASSWORD</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full p-2.5 bg-slate-800/60 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* --- Confirm Password Field --- */}
          <div className="mb-6">
            <label htmlFor="confirmPassword" className="block text-xs font-semibold text-gray-300 mb-2 tracking-wider">CONFIRM PASSWORD</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full p-2.5 bg-slate-800/60 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white font-bold py-2.5 px-4 rounded-md hover:bg-blue-700 transition duration-200 disabled:bg-slate-500"
          >
            {isLoading ? 'Creating account...' : 'CREATE ACCOUNT'}
          </button>

          {error && <p className="text-red-500 text-sm mt-3 text-center">{error}</p>}
        </form>

        {/* --- Link to Login Page --- */}
        <div className="text-center mt-6 pt-4 border-t border-slate-700">
          <p className="text-sm text-gray-400">
            Already have an account?{" "}
            <Link href="/login" legacyBehavior>
              <a className="font-semibold text-blue-400 hover:underline">Login</a>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}