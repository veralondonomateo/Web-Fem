export default function ShippingSection() {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-6 h-6 rounded-full bg-[#fc5245] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">3</span>
        </div>
        <h2 className="font-semibold text-gray-900">Método de envío</h2>
      </div>

      <div className="flex items-center justify-between bg-gray-50 rounded-md border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-md flex items-center justify-center border border-gray-200">
            <svg className="w-4.5 h-4.5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">Envío estándar</p>
            <p className="text-xs text-gray-500 mt-0.5">3–5 días hábiles · Todo Colombia</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 line-through">$15.000</span>
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded">
            GRATIS
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Recibirás un mensaje de WhatsApp con el número de guía para rastrear tu pedido
      </p>
    </section>
  );
}
