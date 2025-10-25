import {getToken} from "./auth";

export async function login(identifier: string, password: string) {
  const res = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
    credentials: "include",
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Login failed");
  }

  return res.json();
}

export async function signup(username: string, email: string, password: string) {
  const res = await fetch("http://localhost:5000/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Signup failed");
  }
  return res.json();
}

export async function updatePassword(currentPassword: string, newPassword: string) {
  const token = getToken();
  if(!token) {
    throw new Error("No auth token found");
  }
  const res = await fetch("http://localhost:5000/api/auth/updatepassword", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Update password failed");
  }
  return res.json();
}

export async function createLobby(character: string, maxPlayers: number) {
  const token = getToken();
  if(!token) {
    throw new Error("No auth token found");
  }
  const res = await fetch("http://localhost:5000/api/lobby/createLobby", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ character, maxPlayers}),
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      
      console.error("Authentication failed for createLobby");
      throw new Error("Authentication failed. Please log in again.");
    }
    const errorData = await res.json();
    throw new Error(errorData.message || "Create Lobby failed");
  }
  return res.json();
}

export async function getLobby(lobbyCode: string) {
  const token = getToken();
  if(!token) {
    throw new Error("No auth token found");
  }
  const res = await fetch(`http://localhost:5000/api/lobby/${lobbyCode}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" , "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Fetch lobby failed");
  }
  return res.json();
}

export async function fetchUserProfile(token: string | undefined | null) {
  if (!token) { // Check the passed token
    throw new Error("Authentication token not provided to fetchUserProfile.");
  }

  const res = await fetch("http://localhost:5000/api/user/me", {
    method: "GET",
    credentials: "include",
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Authentication failed when fetching profile.");
    }
    const errorData = await res.json();
    throw new Error(errorData.message || "Fetch profile failed");
  }
  return res.json();
}

export async function getUsername(): Promise<string> {
  const token = getToken(); 
  if (!token) {
      throw new Error("Authentication token not found.");
  }
  const res = await fetch("http://localhost:5000/api/user/username", {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Fetch username failed");
  }
  const data = await res.json();
  return data.username;
}

export async function getLeaderboard(){
  const res = await fetch("http://localhost:5000/api/leaderboard", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Fetch leaderboard failed");
  }
  return res.json();
} 

export async function readyUp(code: string){
  const token = getToken();
  if(!token) {
    throw new Error("No auth token found");
  }
  const res = await fetch(`http://localhost:5000/api/lobby/ready/${code}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Ready up failed");
  }
  return res.json();
}



export async function uploadAvatar(file: File, token: string | null | undefined, onProgress?: (percent: number) => void) {
  
  if (!token) {
    throw new Error("No auth token found");
  }
  const formData = new FormData();
  formData.append("avatar", file);
  const res = await fetch("http://localhost:5000/api/user/avatar", {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Authentication failed. Please log in again.");
    }
    const errorData = await res.json();
    throw new Error(errorData.message || "Upload avatar failed");
  }
  return res.json();
}