
"use client";
import { UserProfileData } from '../components/user-profile'; // Adjusted path
import { ArrowLeft } from 'lucide-react';


export default function ProfilePage() {
    return (
        <div className="relative min-h-screen flex flex-col items-center justify-center bg-gray-900 p-4">
            <button
                onClick={() => window.history.back()}
                className="absolute top-4 left-4 sm:top-8 sm:left-8 flex items-center gap-2 rounded-full bg-gray-800/50 p-2 pr-4 text-sm text-gray-300 hover:text-white hover:bg-gray-700/70 transition-all"
            >
                <ArrowLeft size={16} />
                Back
            </button>
            
            {/* Render UserProfileData directly */}
            <UserProfileData /> 
        </div>
    );
}