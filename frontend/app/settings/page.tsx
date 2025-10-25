"use client";

import { useState } from "react";
import { saveToken } from "@/lib/auth";
import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Divider,
  Button,
  Input,
  Slider,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import Link from "next/link";
import { updatePassword } from "@/lib/api";
import { Volume2, Music, KeyRound, Trash2, ArrowLeft } from "lucide-react"; // Icons

export default function SettingsPage() {

  const [soundVolume, setSoundVolume] = useState<number | number[]>(75);
  const [musicVolume, setMusicVolume] = useState<number | number[]>(50);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onOpenChange: onDeleteOpenChange,
  } = useDisclosure();
  const {
    isOpen: isPasswordOpen,
    onOpen: onPasswordOpen,
    onOpenChange: onPasswordOpenChange,
  } = useDisclosure();

  const handlePasswordModalOpenChange = () => {
    onPasswordOpenChange(); // Call the original hook function
    // Reset state when modal is closed
    if (!isPasswordOpen) {
      setTimeout(() => { // Delay reset slightly to avoid flash of old state
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordError(null);
        setPasswordSuccess(null);
        setIsUpdatingPassword(false);
      }, 300); // Adjust delay if needed
    }
  };

  const handleSaveSettings = () => {
    // TODO: Send volume settings (soundVolume, musicVolume) to backend
    console.log("Saving settings:", { soundVolume, musicVolume });
  
  };

  const handlePasswordUpdateSubmit = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Please fill in all password fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
        setPasswordError("New password must be at least 6 characters long.");
        return;
    }

    setIsUpdatingPassword(true);
    try {
      
      const token = await updatePassword(currentPassword, newPassword);
      setPasswordSuccess("Password updated successfully!");
      saveToken(token); 
      setTimeout(() => {
        handlePasswordModalOpenChange(); // Use custom handler to close and reset
      }, 1500);

    } catch (error: any) {
      console.error("Password update failed:", error);
      setPasswordError(error.message || "Failed to update password. Please check current password.");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  

  const handleDeleteAccount = () => {
    // TODO: Implement account deletion logic AFTER confirmation
    console.log("Account deletion confirmed");
    // Call API to delete account
    onDeleteOpenChange(); // Close the modal
    // Log user out and redirect
  };



  return (
    // 3. Added 'relative' to the main container
    <div className="relative min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4 sm:p-6 lg:p-8">

      {/* 4. Added Back Link */}
      <Link href="/dashboard" legacyBehavior>
        <a className="absolute top-4 left-4 sm:top-6 sm:left-6 lg:top-8 lg:left-8 flex items-center gap-2 text-gray-300 hover:text-white transition-colors z-10">
          <ArrowLeft size={20} />
          <span>Back to Dashboard</span>
        </a>
      </Link>

      <Card className="max-w-2xl w-full bg-slate-900/80 text-gray-200 border border-slate-700 shadow-xl">
        <CardHeader className="flex flex-col items-start px-6 pt-6">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-gray-400">Manage your account and preferences.</p>
        </CardHeader>

        <CardBody className="px-6 py-4 space-y-6">
          {/* --- Account Management --- */}
          <section>
            <h2 className="text-lg font-semibold mb-3 text-blue-400">Account Management</h2>
            <div className="space-y-3">
              <Button
                color="primary"
                variant="bordered"
                startContent={<KeyRound size={18} />}
                onPress={onPasswordOpen}
                className="w-full justify-start"
              >
                Change Password
              </Button>
              <Button
                color="danger"
                variant="bordered"
                startContent={<Trash2 size={18} />}
                onPress={onDeleteOpen}
                className="w-full justify-start"
              >
                Delete Account
              </Button>
            </div>
          </section>

          <Divider className="bg-slate-700" />

          {/* --- Game Preferences --- */}
          <section>
            <h2 className="text-lg font-semibold mb-4 text-blue-400">Game Preferences</h2>
            <div className="space-y-5">
              <Slider
                label="Sound Effects Volume"
                size="sm"
                step={1}
                maxValue={100}
                minValue={0}
                value={soundVolume}
                onChange={setSoundVolume}
                className="max-w-md"
                startContent={<Volume2 size={18} />}
                getValue={(value) => `${value}%`}
              />
              <Slider
                label="Music Volume"
                size="sm"
                step={1}
                maxValue={100}
                minValue={0}
                value={musicVolume}
                onChange={setMusicVolume}
                className="max-w-md"
                startContent={<Music size={18} />}
                getValue={(value) => `${value}%`}
              />
            </div>
          </section>
        </CardBody>

        <CardFooter className="px-6 pb-6 pt-4 flex justify-end">
          <Button color="primary" onPress={handleSaveSettings}>
            Save Preferences
          </Button>
        </CardFooter>
      </Card>

      {/* --- Modals --- */}
      {/* ... (Modal code remains the same) ... */}
      {/* Change Password Modal (Basic Structure) */}
      <Modal isOpen={isPasswordOpen} onOpenChange={onPasswordOpenChange} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Change Password</ModalHeader>
              <ModalBody className="space-y-4"> {}
                {}
                <Input
                   type="password"
                   label="Current Password"
                   value={currentPassword}
                   onValueChange={setCurrentPassword}
                   isRequired
                   variant="bordered"
                 />
                <Input
                   type="password"
                   label="New Password"
                   value={newPassword}
                   onValueChange={setNewPassword}
                   isRequired
                   variant="bordered"
                   description="Must be at least 6 characters long."
                 />
                <Input
                   type="password"
                   label="Confirm New Password"
                   value={confirmPassword}
                   onValueChange={setConfirmPassword}
                   isRequired
                   variant="bordered"
                 />
                
                 {passwordError && <p className="text-red-500 text-sm">{passwordError}</p>}
                 {passwordSuccess && <p className="text-green-500 text-sm">{passwordSuccess}</p>}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose} disabled={isUpdatingPassword}>Cancel</Button>
                <Button color="primary" onPress={handlePasswordUpdateSubmit} isLoading={isUpdatingPassword}>
                   Update Password
                 </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Account Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onOpenChange={onDeleteOpenChange} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Confirm Account Deletion</ModalHeader>
              <ModalBody>
                <p>Are you sure you want to delete your account? This action cannot be undone.</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>Cancel</Button>
                <Button color="danger" onPress={handleDeleteAccount}>Delete My Account</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

    </div>
  );
}