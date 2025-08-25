"use client";

import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex bg-gray-800 items-center px-4 sm:px-6 justify-between gap-4 h-20 shadow-lg border-b border-gray-700">
      <span className="text-white font-semibold text-lg sm:text-xl">
        Geo Viewer
      </span>
      <div className="p-4 gap-3 sm:gap-4 flex justify-center items-center">
        <SignedOut>
          <SignInButton>
            <button className="bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 cursor-pointer transition-colors">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton>
            <button className="bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 cursor-pointer transition-colors">
              Sign Up
            </button>
          </SignUpButton>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </header>
  );
}
