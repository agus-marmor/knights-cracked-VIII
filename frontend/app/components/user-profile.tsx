'use client';

import { useState, useEffect, useRef } from 'react'; // Import hooks
import { fetchUserProfile, uploadAvatar } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { User, ClipboardList, Zap, BadgeCheck, Star, TrendingUp, Trophy, Camera } from 'lucide-react';
import { Avatar, Progress } from "@heroui/react";

interface UserProfile {
    id: string;
    username: string;
    email: string;
    avatarUrl?: string;
    stats: {
        totalMatches: number;
        avgWPM: number;
        peakWPM: number;
        wins: number;
        losses: number;
        winRate: number;
    };
}
export function ProfileLoadingSkeleton() {
    // Make skeleton slightly bigger to accommodate more stats
    return (
        <div className="bg-gray-800 shadow-xl rounded-2xl p-8 max-w-lg w-full text-center animate-pulse"> {/* Increased max-w */}
            <div className="w-24 h-24 bg-gray-700 rounded-full mx-auto mb-4"></div>
            <div className="h-8 bg-gray-700 rounded w-1/2 mx-auto mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-1/4 mx-auto mb-8"></div> {/* Increased mb */}

            {/* Stats Placeholders (Now maybe 2 rows or wider grid) */}
            <div className="grid grid-cols-3 gap-6 text-center"> {/* Increased gap */}
                {/* Stat 1 */}
                <div> <div className="w-8 h-8 bg-gray-700 rounded mx-auto mb-2"></div> <div className="h-4 bg-gray-700 rounded w-3/4 mx-auto mb-2"></div> <div className="h-10 bg-gray-700 rounded w-1/2 mx-auto"></div> </div>
                {/* Stat 2 */}
                <div> <div className="w-8 h-8 bg-gray-700 rounded mx-auto mb-2"></div> <div className="h-4 bg-gray-700 rounded w-3/4 mx-auto mb-2"></div> <div className="h-10 bg-gray-700 rounded w-1/2 mx-auto"></div> </div>
                {/* Stat 3 */}
                <div> <div className="w-8 h-8 bg-gray-700 rounded mx-auto mb-2"></div> <div className="h-4 bg-gray-700 rounded w-3/4 mx-auto mb-2"></div> <div className="h-10 bg-gray-700 rounded w-1/2 mx-auto"></div> </div>
                {/* Add placeholders for new stats if changing layout */}
            </div>
        </div>
    );
}


export function UserProfileData() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // fetching logic remains the same
        const loadProfile = async () => {
            setLoading(true); setError(null); const token = getToken();
            if (!token) { setError("Not authenticated"); setLoading(false); return; }
            try {
                const data: UserProfile = await fetchUserProfile(token);
                // Simple validation
                if (!data || !data.stats || typeof data.username !== 'string') {
                    throw new Error("Invalid profile data received.");
                }
                setProfile(data);
            } catch (err: any) {
                console.error("Failed to fetch profile:", err);
                setError(err.message || "Failed to load profile.");
            } finally { setLoading(false); }
        };
        loadProfile();
    }, []);

    const handleAvatarClick = () => {
        if (isUploading) return; // Prevent multiple uploads
        fileInputRef.current?.click();
    };
    const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;


        if (file.size > 5 * 1024 * 1024) {
            setUploadError("File is too large (max 5MB).");
            return;
        }
        if (!file.type.startsWith("image/")) {
            setUploadError("Please select an image file.");
            return;
        }
        setIsUploading(true);
        setUploadError(null);
        setUploadProgress(0);
        try {
            const token = getToken();
            if (!token) {
                throw new Error("Not authenticated");
            }
            const updatedProfile: UserProfile = await uploadAvatar(file, token, (progress) => {
                setUploadProgress(progress);
            });
            setProfile(updatedProfile);
        } catch (err: any) {
            console.error("Avatar upload failed:", err);
            setUploadError(err.message || "Failed to upload avatar.");
        } finally {
            setIsUploading(false);
            // Clear the file input value so the same file can be selected again if needed
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };
    if (loading) { return <ProfileLoadingSkeleton />; }

    if (error || !profile) {
        return (
            <div className="bg-red-100 text-red-800 p-4 rounded-lg max-w-lg w-full text-center">
                <p>Error loading profile: {error || "Unknown error"}</p>
            </div>
        );
    }


    return (
        <div className="bg-gray-800 shadow-xl rounded-2xl p-8 max-w-lg w-full text-center text-white">
            {/* Avatar Section */}
            <div
                className="relative w-24 h-24 mx-auto mb-4 group cursor-pointer"
                onClick={handleAvatarClick}
            >
                <Avatar
                    src={profile.avatarUrl} // Uses the updated URL after successful upload
                    fallback={<User className="w-16 h-16 text-indigo-100" />}
                    isBordered
                    color="primary"
                    className="w-full h-full text-large transition-opacity group-hover:opacity-60"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-8 h-8 text-white" />
                </div>
                <input
                    type="file" ref={fileInputRef} onChange={handleAvatarChange}
                    accept="image/png, image/jpeg, image/gif, image/webp" hidden
                />
                {isUploading && (
                    <Progress size="sm" value={uploadProgress} color="primary" className="absolute bottom-[-10px] left-0 right-0 w-full" />
                )}
            </div>
            {uploadError && <p className="text-red-500 text-xs mt-1 mb-2">{uploadError}</p>}

            <h1 className="text-3xl font-bold text-white mb-1"> {}
                {profile.username}
            </h1>
            <p className="text-gray-400 text-sm mb-6">{profile.email}</p> {}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-6 text-center border-t border-gray-700 pt-6"> {}
                {/* Matches */}
                <div>
                    <ClipboardList className="w-7 h-7 text-indigo-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Matches</p>
                    <p className="text-3xl font-bold text-indigo-300">{profile.stats.totalMatches}</p> {}
                </div>
                {/* Avg WPM */}
                <div>
                    <Zap className="w-7 h-7 text-indigo-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Avg WPM</p>
                    <p className="text-3xl font-bold text-indigo-300">{profile.stats.avgWPM.toFixed(1)}</p>
                </div>
                {/* Peak WPM */}
                <div>
                    <TrendingUp className="w-7 h-7 text-indigo-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Peak WPM</p>
                    <p className="text-3xl font-bold text-indigo-300">{profile.stats.peakWPM.toFixed(1)}</p>
                </div>
                {/* Wins */}
                <div>
                    <Trophy className="w-7 h-7 text-green-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Wins</p>
                    <p className="text-3xl font-bold text-green-300">{profile.stats.wins}</p>
                </div>
                {/* Losses */}
                <div>
                    {}
                    <BadgeCheck className="w-7 h-7 text-red-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Losses</p>
                    <p className="text-3xl font-bold text-red-300">{profile.stats.losses}</p>
                </div>
                {/* Win Rate */}
                <div>
                    <Star className="w-7 h-7 text-yellow-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Win Rate</p>
                    <p className="text-3xl font-bold text-yellow-300">
                        {/* Backend sends percentage directly */}
                        {profile.stats.winRate}%
                    </p>
                </div>
            </div>
        </div>
    );
}