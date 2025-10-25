"use client";

import { useEffect, useState } from "react";
import { getToken, logout } from "@/lib/auth";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
    
      window.location.href = "/login";
    } else {
      
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <p>Loading...</p>; 
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Welcome to your Dashboard</h1>
      <p className="mb-4">
        You are successfully logged in. 
      </p>

      <button
        onClick={logout}
        className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
      >
        Logout
      </button>
    </div>
  );
}
