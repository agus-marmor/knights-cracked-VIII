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
  <div
    className="h-screen w-screen bg-cover bg-center bg-no-repeat flex items-center justify-center"
    style={{
      backgroundImage: "url('/mainPage.jpg')",
    }}
  >
    <div className="bg-slate-900/90 p-8 rounded-xl shadow-lg max-w-3xl w-full mx-6 text-gray-100">
      <h1 className="text-3xl font-bold mb-4 text-center">
        Welcome to your Dashboard
      </h1>
      

      <div className="flex flex-col gap-3 items-center mb-6">
        <button onClick={()=> window.location.href = "/createLobby"} className="w-64 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Create Lobby
        </button>
        <button className="w-64 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Join Lobby
        </button>
        <button className="w-64 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          View Leaderboard
        </button>
        <button className="w-64 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Profile Setting
        </button>
      </div>

      <div className="flex justify-center">
        <button
          onClick={logout}
          className="bg-red-600 text-white px-6 py-2 rounded-md hover:bg-red-700 transition"
        >
          Logout
        </button>
      </div>
    </div>
  </div>
  );
}
