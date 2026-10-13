import Image from "next/image";
import Link from "next/link";

export default function CheckoutHeader() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      {/* Trust bar */}
      <div className="border-b border-gray-100 py-2 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-4 sm:gap-10">
          <div className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Compra segura</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>+30.000 clientas</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span>Envío gratis</span>
          </div>
        </div>
      </div>

      {/* Main header */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image
            src="/logo.svg"
            alt="FEM"
            width={100}
            height={32}
            priority
            className="h-8 w-auto"
          />
        </Link>

      </div>
    </header>
  );
}
