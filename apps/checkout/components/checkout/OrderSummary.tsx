"use client";

import Image from "next/image";
import { OrderItem } from "@/types/checkout";

interface OrderSummaryProps {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  coupon?: string;
  couponApplied?: boolean;
  couponError?: string;
  discount?: number;
  onCouponChange?: (value: string) => void;
  onCouponApply?: () => void;
  mainQty?: number;
  onMainQtyChange?: (qty: number) => void;
}

function formatCOP(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function OrderSummary({
  items, subtotal, shipping, total,
  coupon = "", couponApplied = false, couponError = "", discount = 0,
  onCouponChange, onCouponApply,
  mainQty, onMainQtyChange,
}: OrderSummaryProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 space-y-5">
      {/* Items */}
      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-start gap-3">
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                <Image src={item.image} alt={item.name} width={56} height={56} className="w-full h-full object-cover" />
              </div>
              {/* Only show qty badge on non-main items or when there's no qty control */}
              {!(idx === 0 && onMainQtyChange) && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#fc5245] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {item.quantity}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 text-sm leading-tight truncate">{item.name}</p>
              {item.variant && <p className="text-xs text-gray-500 mt-0.5">{item.variant}</p>}
              {idx === 0 && onMainQtyChange && mainQty !== undefined && (
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => onMainQtyChange(Math.max(1, mainQty - 1))}
                    className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-base font-medium leading-none"
                  >
                    −
                  </button>
                  <span className="text-sm font-semibold text-gray-900 w-4 text-center">{mainQty}</span>
                  <button
                    type="button"
                    onClick={() => onMainQtyChange(mainQty + 1)}
                    className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-base font-medium leading-none"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            <p className="font-semibold text-gray-900 text-sm flex-shrink-0">
              {formatCOP(item.price * item.quantity)}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100" />

      {/* Coupon */}
      {onCouponChange && onCouponApply && (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">Código de descuento</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={coupon}
                onChange={(e) => onCouponChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onCouponApply()}
                placeholder="Ej: FEM10"
                className={`flex-1 px-3.5 py-2.5 rounded-md border text-sm bg-white placeholder-gray-400 text-gray-900
                  focus:outline-none focus:ring-1 focus:ring-[#fc5245]/20 focus:border-[#fc5245] transition-colors duration-150
                  ${couponError ? "border-red-300" : couponApplied ? "border-green-400 bg-green-50" : "border-gray-300"}`}
                disabled={couponApplied}
              />
              <button
                onClick={onCouponApply}
                disabled={couponApplied || !coupon.trim()}
                className="px-4 py-2.5 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {couponApplied ? "✓" : "Aplicar"}
              </button>
            </div>
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
            {couponApplied && discount > 0 && (
              <p className="text-xs text-green-600 mt-1 font-medium">
                Descuento aplicado: -{new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(discount)}
              </p>
            )}
          </div>

          <div className="border-t border-gray-100" />
        </>
      )}

      {/* Totals */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span>
          <span className="font-medium text-gray-900">{formatCOP(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>Envío</span>
          <div className="flex items-center gap-2">
            <span className="line-through text-gray-400">{formatCOP(shipping)}</span>
            <span className="text-xs font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">GRATIS</span>
          </div>
        </div>
        {couponApplied && discount > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>Descuento</span>
            <span className="font-medium">-{formatCOP(discount)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200" />

      {/* Total */}
      <div className="flex justify-between items-center">
        <span className="font-semibold text-gray-900">Total</span>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">COP</p>
          <p className="text-xl font-bold text-gray-900">{formatCOP(total)}</p>
        </div>
      </div>

      {/* Trust badges */}
      <div className="border-t border-gray-100 pt-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { icon: "🚚", text: "Envío rápido" },
            { icon: "💰", text: "Compra acompañada" },
            { icon: "🇨🇴", text: "Hecho en Colombia" },
          ].map(({ icon, text }) => (
            <div key={text} className="flex flex-col items-center gap-1">
              <span className="text-base">{icon}</span>
              <span className="text-[10px] text-gray-500 font-medium leading-tight">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
