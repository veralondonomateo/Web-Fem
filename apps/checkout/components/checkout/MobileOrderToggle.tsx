"use client";

import { useState } from "react";
import { OrderItem } from "@/types/checkout";
import OrderSummary from "./OrderSummary";

interface Props {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  mainQty?: number;
  onMainQtyChange?: (qty: number) => void;
}

function formatCOP(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function MobileOrderToggle({ items, subtotal, shipping, total, mainQty, onMainQtyChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between bg-gray-50 border-y border-gray-200 px-4 py-3"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-[#fc5245]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          Ver resumen del pedido
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <span className="font-bold text-gray-900 text-sm">{formatCOP(total)}</span>
      </button>

      {open && (
        <div className="px-4 py-4 bg-white border-b border-gray-200">
          <OrderSummary items={items} subtotal={subtotal} shipping={shipping} total={total} mainQty={mainQty} onMainQtyChange={onMainQtyChange} />
        </div>
      )}
    </div>
  );
}
