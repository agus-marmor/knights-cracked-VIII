"use client";

import { useState } from "react";
import { login } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation"; 

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter(); 

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const data = await login(identifier, password);
      saveToken(data.token);
      
      
      router.push("/dashboard"); // redirect
    } catch (err: any) {
      setError(err.message || "Login failed");
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
        <h2 className="text-2xl font-semibold mb-6 tracking-wider text-center">LOGIN</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="email" className="block text-xs font-semibold text-gray-300 mb-2 tracking-wider">USERNAME OR EMAIL</label>
            <input
              type="text" 
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="w-full p-2.5 bg-slate-800/60 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

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

          <button
            type="submit"
            disabled={isLoading} 
            className="w-full bg-blue-600 text-white font-bold py-2.5 px-4 rounded-md hover:bg-blue-700 transition duration-200 disabled:bg-slate-500"
          >
        
            {isLoading ? 'Logging in...' : 'LOGIN'}
          </button>

          {error && <p className="text-red-500 text-sm mt-3 text-center">{error}</p>}
          
          <div className="text-center mt-5">
            <Link href="/forgot-password" legacyBehavior>
              <a className="text-sm text-gray-300 hover:underline">Forgot password?</a>
            </Link>
          </div>
        </form>

        <div className="text-center mt-6 pt-4 border-t border-slate-700">
          <p className="text-sm text-gray-400">
            Don't have an account?{" "}
            <Link href="/signup" legacyBehavior>
              <a className="font-semibold text-blue-400 hover:underline">Sign Up</a>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}