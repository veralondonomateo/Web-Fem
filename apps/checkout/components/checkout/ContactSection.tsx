"use client";

import { UseFormRegister, FieldErrors } from "react-hook-form";
import { CheckoutFormData } from "@/types/checkout";
import Input from "@/components/ui/Input";

interface ContactSectionProps {
  register: UseFormRegister<CheckoutFormData>;
  errors: FieldErrors<CheckoutFormData>;
  onEmailBlur?: (email: string) => void;
}

export default function ContactSection({ register, errors, onEmailBlur }: ContactSectionProps) {
  const emailField = register("email");

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-6 h-6 rounded-full bg-[#fc5245] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">1</span>
        </div>
        <h2 className="font-semibold text-gray-900">Contacto</h2>
      </div>

      <div className="space-y-4">
        <Input
          label="Correo electrónico"
          type="email"
          placeholder="tu@email.com"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
          error={errors.email?.message}
          {...emailField}
          onBlur={(e) => {
            // Preserve react-hook-form's own blur handling, then notify parent.
            emailField.onBlur(e);
            onEmailBlur?.(e.target.value);
          }}
        />

        <label className="flex items-center gap-2.5 cursor-pointer select-none group">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only peer"
              {...register("saveInfo")}
            />
            <div className="w-5 h-5 rounded-full border-2 border-gray-300 peer-checked:border-green-500 peer-checked:text-green-500 text-gray-300 group-hover:border-gray-400 transition-colors flex items-center justify-center">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <span className="text-sm text-gray-600">Recibir novedades y ofertas por correo</span>
        </label>
      </div>
    </section>
  );
}
