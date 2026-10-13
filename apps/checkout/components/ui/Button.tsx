"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  fullWidth?: boolean;
}

export default function Button({
  children,
  variant = "primary",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const base = `
    inline-flex items-center justify-center gap-2
    font-semibold rounded-lg px-6 py-4
    transition-all duration-150 ease-in-out
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-60 disabled:cursor-not-allowed
    active:scale-[0.99]
    ${fullWidth ? "w-full" : ""}
  `;

  const variants = {
    primary: `
      bg-gradient-to-r from-[#fc5245] to-[#ff7f75]
      text-white shadow-md shadow-[#fc5245]/30
      hover:from-[#e83d30] hover:to-[#fc5245]
      hover:shadow-lg hover:shadow-[#fc5245]/40
      focus:ring-[#ffa69e]
    `,
    secondary: `
      bg-white text-[#fc5245] border-2 border-[#ffa69e]
      hover:bg-[#fff0f0] hover:border-[#fc5245]
      focus:ring-[#ffa69e]
    `,
    ghost: `
      bg-transparent text-gray-600
      hover:bg-gray-100
      focus:ring-gray-300
    `,
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <svg
            className="animate-spin h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Procesando...
        </>
      ) : (
        children
      )}
    </button>
  );
}
