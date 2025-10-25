"use client";
import { useEffect } from "react";
import { getToken } from "@/lib/auth";

export default function HomePage() {
  useEffect(() => {
    if (getToken()) {
      window.location.href = "/dashboard"; // redirect logged-in users
    } else {
      window.location.href = "/login"; // redirect guests
    }
  }, []);

  return null; // Show nothing while redirecting
}
