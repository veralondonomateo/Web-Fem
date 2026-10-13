"use client";

import { useEffect, useRef, useState } from "react";

export default function ExitIntentPopup({ couponApplied = false }: { couponApplied?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300);
  const triggered = useRef(false); // guards against multiple fires

  useEffect(() => {
    if (sessionStorage.getItem("fem-exit-shown") || couponApplied) return;

    // Detect touch device
    const isMobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

    let ready = false;
    const readyTimer = setTimeout(() => { ready = true; }, isMobile ? 8000 : 5000);

    const trigger = () => {
      if (!ready || triggered.current) return;
      triggered.current = true;
      setShow(true);
      sessionStorage.setItem("fem-exit-shown", "1");
    };

    if (!isMobile) {
      // Desktop: cursor leaving viewport through top
      const handleLeave = (e: MouseEvent) => {
        if (e.clientY <= 5) trigger();
      };
      document.addEventListener("mouseleave", handleLeave);
      return () => {
        document.removeEventListener("mouseleave", handleLeave);
        clearTimeout(readyTimer);
      };
    } else {
      // Mobile: detect rapid scroll-up toward top (back-navigation intent)
      let lastY = window.scrollY;
      let upDelta = 0;

      const handleScroll = () => {
        const y = window.scrollY;
        if (y < lastY) {
          upDelta += lastY - y;
          if (upDelta > 120 && y < 200) trigger();
        } else {
          upDelta = 0;
        }
        lastY = y;
      };

      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", handleScroll);
        clearTimeout(readyTimer);
      };
    }
  }, []);

  useEffect(() => {
    if (!show || timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [show, timeLeft]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const handleCopy = () => {
    navigator.clipboard.writeText("MISTERIOSO").catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!show || couponApplied) return null;

  return (
    /* Mobile: bottom sheet · Desktop: centered modal */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => setShow(false)}
      />

      <div className="relative bg-white rounded-t-xl sm:rounded-lg shadow-2xl w-full sm:max-w-sm z-10 overflow-hidden">
        {/* Top accent */}
        <div className="h-1 bg-[#fc5245]" />

        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-8 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="p-5 sm:p-6">
          {/* Close */}
          <button
            onClick={() => setShow(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-1"
            aria-label="Cerrar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header row */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#fc5245]/10 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-[#fc5245]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                ¡Espera, tenemos algo para ti!
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                5% de descuento si completas tu pedido ahora
              </p>
            </div>
          </div>

          {/* Code */}
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-md px-4 py-3 mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest">Tu código</p>
              <p className="text-xl font-bold tracking-widest text-gray-900">MISTERIOSO</p>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copiado
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copiar
                </>
              )}
            </button>
          </div>

          {/* Countdown */}
          {timeLeft > 0 && (
            <div className="flex items-center justify-center gap-1.5 mb-4 text-xs text-gray-500">
              <svg className="w-3.5 h-3.5 text-[#fc5245]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Oferta expira en{" "}
              <span className="font-bold text-gray-900 tabular-nums">{fmt(timeLeft)}</span>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => setShow(false)}
            className="w-full py-3.5 rounded-md bg-[#fc5245] text-white text-sm font-semibold hover:bg-[#e83d30] transition-colors"
          >
            Completar mi compra →
          </button>

          {/* Dismiss */}
          <button
            onClick={() => setShow(false)}
            className="w-full mt-3 pb-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            No gracias
          </button>
        </div>
      </div>
    </div>
  );
}
