"use client";

import { forwardRef, SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  loading?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, placeholder, options, loading, className = "", ...props }, ref) => {
    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
        <div className="relative">
          <select
            ref={ref}
            className={`
              w-full px-4 py-3 rounded-md border bg-white
              text-gray-900
              transition-colors duration-150
              cursor-pointer
              ${
                error
                  ? "border-red-400 bg-red-50 focus:border-red-400 focus:ring-1 focus:ring-red-300"
                  : "border-gray-300 hover:border-gray-400 focus:border-[#fc5245] focus:ring-1 focus:ring-[#fc5245]/20"
              }
              focus:outline-none
              disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
              ${loading ? "animate-pulse" : ""}
              ${className}
            `}
            {...props}
          >
            <option value="">{placeholder ?? `Selecciona ${label.toLowerCase()}`}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {loading && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4 text-[#ffa69e]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1 animate-fade-in-up">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
export default Select;
